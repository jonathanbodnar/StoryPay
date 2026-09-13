import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { sendWeddingPlannerCollaboratorInviteEmail } from '@/lib/wedding-planner-emails';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com').replace(/\/$/, '');

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

const COORDINATOR_COLUMNS = 'id, name, email, phone, access_level, status, collaborator_user_id, created_at, accepted_at';

/** Load the wedding link and confirm it belongs to this venue + is linked. */
async function loadLink(weddingId: string, venueId: string) {
  const { data } = await supabaseAdmin
    .from('couple_weddings')
    .select('id, venue_id, venue_customer_id, status')
    .eq('id', weddingId)
    .eq('venue_id', venueId)
    .maybeSingle();
  return data as { id: string; venue_id: string; venue_customer_id: string | null; status: string } | null;
}

/** GET — the current coordinator (if any) for this couple's wedding. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ weddingId: string }> }) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { weddingId } = await params;
  const link = await loadLink(weddingId, venueId);
  if (!link || link.status !== 'linked') return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data } = await supabaseAdmin
    .from('wedding_planner_collaborators')
    .select(COORDINATOR_COLUMNS)
    .eq('couple_wedding_id', weddingId)
    .eq('invited_by', 'venue')
    .eq('role', 'coordinator')
    .neq('status', 'revoked')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({ coordinator: data ?? null });
}

/**
 * POST — invite/assign the couple's wedding coordinator. Body: { name, email, phone }.
 * The coordinator comes in as an EDIT collaborator (role='coordinator'), separate
 * from the couple's 5-invite cap (at most one per wedding). Also mirrors the name
 * / phone into the wedding's coordinator fields on venue_customers.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ weddingId: string }> }) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { weddingId } = await params;
  const link = await loadLink(weddingId, venueId);
  if (!link || link.status !== 'linked') return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let body: { name?: string; email?: string; phone?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const name = (body.name ?? '').trim().slice(0, 120);
  const email = (body.email ?? '').trim().toLowerCase().slice(0, 200);
  const phone = (body.phone ?? '').trim().slice(0, 40);
  if (!name) return NextResponse.json({ error: 'A name is required.' }, { status: 400 });
  if (!email || !isEmail(email)) return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 });
  if (!phone) return NextResponse.json({ error: 'A phone number is required.' }, { status: 400 });

  const token = randomBytes(24).toString('hex');

  // At most one coordinator per wedding — reuse the existing (non-revoked) row.
  const { data: existing } = await supabaseAdmin
    .from('wedding_planner_collaborators')
    .select('id')
    .eq('couple_wedding_id', weddingId)
    .eq('invited_by', 'venue')
    .eq('role', 'coordinator')
    .neq('status', 'revoked')
    .maybeSingle();

  let coordinator: Record<string, unknown> | null = null;
  if (existing) {
    const { data, error } = await supabaseAdmin
      .from('wedding_planner_collaborators')
      .update({ name, email, phone, access_level: 'edit', invite_token: token })
      .eq('id', (existing as { id: string }).id)
      .select(COORDINATOR_COLUMNS)
      .single();
    if (error) {
      console.error('[venue/wedding-planner/coordinator] update', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    coordinator = data as Record<string, unknown>;
  } else {
    const { data, error } = await supabaseAdmin
      .from('wedding_planner_collaborators')
      .insert({
        couple_wedding_id: weddingId,
        invited_by: 'venue',
        role: 'coordinator',
        name,
        email,
        phone,
        access_level: 'edit',
        status: 'invited',
        invite_token: token,
      })
      .select(COORDINATOR_COLUMNS)
      .single();
    if (error) {
      console.error('[venue/wedding-planner/coordinator] insert', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    coordinator = data as Record<string, unknown>;
  }

  // Mirror into the wedding's coordinator fields (venue_customers) — only fill
  // what's provided, never null out existing values unexpectedly.
  if (link.venue_customer_id) {
    await supabaseAdmin
      .from('venue_customers')
      .update({ coordinator_name: name, coordinator_phone: phone, updated_at: new Date().toISOString() })
      .eq('id', link.venue_customer_id);
  }

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('name, brand_email')
    .eq('id', venueId)
    .maybeSingle();
  const venueName = (venue as { name?: string | null } | null)?.name?.trim() || 'your venue';
  const brandEmail = (venue as { brand_email?: string | null } | null)?.brand_email?.trim() || undefined;

  const acceptUrl = `${APP_URL}/couple/accept-invite?token=${token}`;
  const sendResult = await sendWeddingPlannerCollaboratorInviteEmail({
    toEmail: email,
    inviteeFirstName: name.split(/\s+/)[0] || '',
    inviterName: venueName,
    venueName,
    accessSummary: 'coordinating guests, seating, the timeline, checklist and vendors (everything except the private budget)',
    acceptUrl,
    brandEmail,
  });

  if (!sendResult.success) {
    return NextResponse.json(
      { error: `Coordinator saved but the email failed to send: ${sendResult.error || 'unknown error'}`, coordinator },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, coordinator });
}
