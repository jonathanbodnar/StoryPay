import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getCoupleAuthUser } from '@/lib/couple-server';
import {
  getActiveCoupleWedding,
  getPendingInviteForEmail,
  getVenueSummary,
  coupleReaderRef,
  type CoupleWeddingRow,
} from '@/lib/couple-weddings';
import { sendEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com').replace(/\/$/, '');

interface WeddingDetails {
  wedding_date: string | null;
  guest_count: number | null;
  ceremony_type: string | null;
  rehearsal_date: string | null;
  coordinator_name: string | null;
  coordinator_phone: string | null;
  space_name: string | null;
}

async function loadWeddingDetails(
  venueId: string,
  venueCustomerId: string | null,
): Promise<WeddingDetails | null> {
  if (!venueCustomerId) return null;
  const { data: vc } = await supabaseAdmin
    .from('venue_customers')
    .select('wedding_date, guest_count, ceremony_type, rehearsal_date, coordinator_name, coordinator_phone, wedding_space_id')
    .eq('id', venueCustomerId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!vc) return null;
  const row = vc as {
    wedding_date: string | null;
    guest_count: number | null;
    ceremony_type: string | null;
    rehearsal_date: string | null;
    coordinator_name: string | null;
    coordinator_phone: string | null;
    wedding_space_id: string | null;
  };

  let spaceName: string | null = null;
  if (row.wedding_space_id) {
    const { data: space } = await supabaseAdmin
      .from('venue_spaces')
      .select('name')
      .eq('id', row.wedding_space_id)
      .maybeSingle();
    spaceName = (space as { name?: string } | null)?.name ?? null;
  }

  return {
    wedding_date: row.wedding_date,
    guest_count: row.guest_count,
    ceremony_type: row.ceremony_type,
    rehearsal_date: row.rehearsal_date,
    coordinator_name: row.coordinator_name,
    coordinator_phone: row.coordinator_phone,
    space_name: spaceName,
  };
}

async function unreadForBride(threadId: string, coupleId: string): Promise<number> {
  const { data: readRow } = await supabaseAdmin
    .from('conversation_thread_reads')
    .select('last_read_at')
    .eq('thread_id', threadId)
    .eq('reader_ref', coupleReaderRef(coupleId))
    .maybeSingle();
  const since = (readRow as { last_read_at?: string } | null)?.last_read_at ?? null;

  let q = supabaseAdmin
    .from('conversation_messages')
    .select('id', { count: 'exact', head: true })
    .eq('thread_id', threadId)
    .eq('visibility', 'external')
    .eq('support_only', false)
    .neq('sender_kind', 'contact'); // only venue -> bride messages count as unread for the bride
  if (since) q = q.gt('created_at', since);
  const { count } = await q;
  return count ?? 0;
}

async function serializeLink(link: CoupleWeddingRow, coupleId: string) {
  const venue = await getVenueSummary(link.venue_id);
  const wedding =
    link.status === 'linked' ? await loadWeddingDetails(link.venue_id, link.venue_customer_id) : null;

  let thread: { id: string; unread: number } | null = null;
  if (link.status === 'linked' && link.venue_customer_id) {
    const { data: t } = await supabaseAdmin
      .from('conversation_threads')
      .select('id')
      .eq('venue_id', link.venue_id)
      .eq('venue_customer_id', link.venue_customer_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const tid = (t as { id?: string } | null)?.id ?? null;
    if (tid) thread = { id: tid, unread: await unreadForBride(tid, coupleId) };
    else thread = { id: '', unread: 0 };
  }

  return {
    id: link.id,
    status: link.status,
    initiated_by: link.initiated_by,
    created_at: link.created_at,
    linked_at: link.linked_at,
    venue,
    wedding,
    thread,
  };
}

export async function GET(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const link = await getActiveCoupleWedding(user.id);
  const pendingInviteRow = user.email ? await getPendingInviteForEmail(user.email) : null;

  let pendingInvite: { id: string; venue: Awaited<ReturnType<typeof getVenueSummary>> } | null = null;
  // Only surface an unclaimed invite when the bride isn't already actively linked
  // to that venue (avoids showing a stale invite for a venue she already joined).
  if (pendingInviteRow && (!link || link.venue_id !== pendingInviteRow.venue_id)) {
    pendingInvite = {
      id: pendingInviteRow.id,
      venue: await getVenueSummary(pendingInviteRow.venue_id),
    };
  }

  return NextResponse.json({
    link: link ? await serializeLink(link, user.id) : null,
    pendingInvite,
  });
}

/**
 * POST /api/couple/wedding
 * Bride requests to connect to a venue she found in the directory.
 * Body: { slug: string, message?: string }
 */
export async function POST(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { slug?: string; message?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const slug = (body.slug ?? '').trim().toLowerCase();
  const message = (body.message ?? '').trim().slice(0, 1000) || null;
  if (!slug) return NextResponse.json({ error: 'slug is required' }, { status: 400 });

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id, name, is_published, email, notification_email')
    .eq('slug', slug)
    .maybeSingle();
  if (!venue || !(venue as { is_published?: boolean }).is_published) {
    return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  }
  const venueId = (venue as { id: string }).id;

  // Already actively connected (pending or linked) to a venue?
  const existing = await getActiveCoupleWedding(user.id);
  if (existing) {
    if (existing.venue_id === venueId) {
      return NextResponse.json(
        { error: existing.status === 'linked' ? 'You are already connected to this venue.' : 'You already have a pending request with this venue.' },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: 'You are already connected to a venue. Disconnect first to connect to a different one.' },
      { status: 409 },
    );
  }

  // Try to auto-match an existing booked-customer record by the bride's email.
  const email = (user.email ?? '').trim().toLowerCase();
  let venueCustomerId: string | null = null;
  if (email) {
    const { data: vc } = await supabaseAdmin
      .from('venue_customers')
      .select('id')
      .eq('venue_id', venueId)
      .ilike('customer_email', email)
      .maybeSingle();
    venueCustomerId = (vc as { id?: string } | null)?.id ?? null;
  }

  const { data: profile } = await supabaseAdmin
    .from('couple_profiles')
    .select('display_name, first_name, last_name')
    .eq('id', user.id)
    .maybeSingle();
  const p = profile as { display_name?: string | null; first_name?: string | null; last_name?: string | null } | null;
  const invitedName =
    [p?.first_name, p?.last_name].filter(Boolean).join(' ').trim() || p?.display_name?.trim() || null;

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from('couple_weddings')
    .insert({
      couple_id: user.id,
      venue_id: venueId,
      venue_customer_id: venueCustomerId,
      status: 'pending',
      initiated_by: 'bride',
      invited_email: email || null,
      invited_name: invitedName,
      request_message: message,
    })
    .select('*')
    .single();

  if (insErr || !inserted) {
    console.error('[couple/wedding POST]', insErr);
    return NextResponse.json({ error: insErr?.message ?? 'Could not create request' }, { status: 500 });
  }

  // Notify the venue by email (best-effort).
  void (async () => {
    try {
      const v = venue as { name?: string | null; email?: string | null; notification_email?: string | null };
      const to = (v.notification_email || v.email || '').trim();
      if (!to) return;
      const venueName = v.name || 'your venue';
      await sendEmail({
        to,
        subject: `New bride portal request${invitedName ? ` from ${invitedName}` : ''}`,
        html: `
<div style="font-family:'Open Sans',Arial,sans-serif;font-size:15px;line-height:1.6;color:#111827">
  <p>${invitedName ? `<strong>${invitedName}</strong>` : 'A couple'} asked to connect with ${venueName} on the StoryVenue bride portal.</p>
  ${message ? `<p style="color:#374151"><em>&ldquo;${message.replace(/</g, '&lt;')}&rdquo;</em></p>` : ''}
  <p>Review and approve this request from your dashboard:</p>
  <p><a href="${APP_URL}/dashboard/bride-portal" style="color:#111827;font-weight:600;text-decoration:underline">Open Bride Portal</a></p>
</div>`,
      });
    } catch (e) {
      console.warn('[couple/wedding POST] venue notify failed', e);
    }
  })();

  return NextResponse.json({ ok: true, link: await serializeLink(inserted as CoupleWeddingRow, user.id) });
}

/**
 * DELETE /api/couple/wedding
 * Bride cancels a pending request or disconnects a linked wedding (from her side).
 */
export async function DELETE(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const link = await getActiveCoupleWedding(user.id);
  if (!link) return NextResponse.json({ ok: true });

  const { error } = await supabaseAdmin
    .from('couple_weddings')
    .update({ status: 'revoked', decided_at: new Date().toISOString() })
    .eq('id', link.id)
    .eq('couple_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
