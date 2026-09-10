import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getCoupleAuthUser } from '@/lib/couple-server';
import {
  getActiveCoupleWedding,
  ensureThreadForCustomer,
  coupleReaderRef,
} from '@/lib/couple-weddings';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface SerializedMessage {
  id: string;
  body: string;
  created_at: string;
  mine: boolean;
  author: string;
}

async function resolveContext(coupleId: string, coupleEmail: string | undefined) {
  const link = await getActiveCoupleWedding(coupleId);
  if (!link || link.status !== 'linked' || !link.venue_customer_id) {
    return { error: 'not_linked' as const };
  }
  const threadId = await ensureThreadForCustomer(link.venue_id, link.venue_customer_id);
  if (!threadId) return { error: 'no_thread' as const };

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('name')
    .eq('id', link.venue_id)
    .maybeSingle();
  const venueName = (venue as { name?: string } | null)?.name || 'Your venue';

  const { data: profile } = await supabaseAdmin
    .from('couple_profiles')
    .select('display_name, first_name, last_name')
    .eq('id', coupleId)
    .maybeSingle();
  const p = profile as { display_name?: string | null; first_name?: string | null; last_name?: string | null } | null;
  const brideName =
    [p?.first_name, p?.last_name].filter(Boolean).join(' ').trim() ||
    p?.display_name?.trim() ||
    (coupleEmail ? coupleEmail.split('@')[0] : 'Guest');

  return {
    link,
    venueId: link.venue_id,
    venueCustomerId: link.venue_customer_id,
    threadId,
    venueName,
    brideName,
  };
}

export async function GET(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ctx = await resolveContext(user.id, user.email);
  if ('error' in ctx) {
    return NextResponse.json({ error: ctx.error, messages: [], venueName: null, linked: false });
  }

  const { data: rows, error } = await supabaseAdmin
    .from('conversation_messages')
    .select('id, body, created_at, sender_kind, visibility, support_only')
    .eq('thread_id', ctx.threadId)
    .eq('visibility', 'external')
    .eq('support_only', false)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[couple/messages GET]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const messages: SerializedMessage[] = (rows ?? []).map((m) => {
    const row = m as { id: string; body: string; created_at: string; sender_kind: string };
    const mine = row.sender_kind === 'contact';
    return {
      id: row.id,
      body: row.body,
      created_at: row.created_at,
      mine,
      author: mine ? 'You' : ctx.venueName,
    };
  });

  // Mark the bride caught up on this thread.
  await supabaseAdmin.from('conversation_thread_reads').upsert(
    { thread_id: ctx.threadId, reader_ref: coupleReaderRef(user.id), last_read_at: new Date().toISOString() },
    { onConflict: 'thread_id,reader_ref' },
  );

  return NextResponse.json({ linked: true, venueName: ctx.venueName, messages });
}

export async function POST(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { body?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const text = (body.body ?? '').trim();
  if (!text) return NextResponse.json({ error: 'Message is empty.' }, { status: 400 });
  if (text.length > 5000) return NextResponse.json({ error: 'Message is too long.' }, { status: 400 });

  const ctx = await resolveContext(user.id, user.email);
  if ('error' in ctx) {
    return NextResponse.json({ error: 'You are not connected to a venue yet.' }, { status: 400 });
  }

  const contactEmail = (user.email ?? '').trim().toLowerCase() || null;

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from('conversation_messages')
    .insert({
      thread_id: ctx.threadId,
      visibility: 'external',
      channel: 'email',
      body: text,
      sender_kind: 'contact',
      contact_from_name: ctx.brideName,
      contact_from_email: contactEmail,
      mentioned_member_ids: [],
      external_email_sent: false,
      send_error: null,
    })
    .select('id, created_at')
    .single();

  if (insErr || !inserted) {
    console.error('[couple/messages POST]', insErr);
    return NextResponse.json({ error: insErr?.message ?? 'Could not send message' }, { status: 500 });
  }
  const messageId = (inserted as { id: string }).id;
  const createdAt = (inserted as { created_at?: string }).created_at || new Date().toISOString();

  // Reopen the thread if the venue had closed it.
  void supabaseAdmin
    .from('conversation_threads')
    .update({ status: 'open' })
    .eq('id', ctx.threadId)
    .eq('status', 'closed')
    .then(() => undefined, () => undefined);

  // Keep the bride caught up on her own message.
  await supabaseAdmin.from('conversation_thread_reads').upsert(
    { thread_id: ctx.threadId, reader_ref: coupleReaderRef(user.id), last_read_at: new Date().toISOString() },
    { onConflict: 'thread_id,reader_ref' },
  );

  // Notify the venue the same way an inbound bride email would: live broadcast,
  // owner push, and a support Slack ping. All best-effort.
  void (async () => {
    try {
      const { broadcastBrideMessage } = await import('@/lib/realtime/broadcast');
      await broadcastBrideMessage({
        inbound: true,
        threadId: ctx.threadId,
        venueId: ctx.venueId,
        venueCustomerId: ctx.venueCustomerId,
        messageId,
        body: text,
        channel: 'email',
        senderKind: 'contact',
        sentByVenueSupport: false,
        supportAgentId: null,
        createdAt,
        attachments: null,
      });
    } catch (e) {
      console.warn('[couple/messages POST] broadcast failed', e);
    }
  })();

  void (async () => {
    try {
      const { notifyOwnerNewMessage } = await import('@/lib/owner-notifications');
      notifyOwnerNewMessage({
        venueId: ctx.venueId,
        threadId: ctx.threadId,
        fromName: ctx.brideName,
        fromEmail: contactEmail ?? '',
        bodyText: text,
        venueCustomerId: ctx.venueCustomerId,
      });
    } catch (e) {
      console.warn('[couple/messages POST] owner notify failed', e);
    }
  })();

  void (async () => {
    try {
      const { notifyBrideReply } = await import('@/lib/slack-notify');
      await notifyBrideReply({
        venueName: ctx.venueName,
        contactName: ctx.brideName,
        messagePreview: text,
        threadId: ctx.threadId,
      });
    } catch (e) {
      console.warn('[couple/messages POST] slack notify failed', e);
    }
  })();

  return NextResponse.json({
    ok: true,
    message: { id: messageId, body: text, created_at: createdAt, mine: true, author: 'You' },
  });
}
