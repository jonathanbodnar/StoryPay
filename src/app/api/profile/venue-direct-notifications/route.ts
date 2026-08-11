import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * GET/PUT /api/profile/venue-direct-notifications
 *
 * Per-person preference for the Venue Direct handoff (see
 * src/app/api/admin/support/venue-direct/route.ts) — whether THIS
 * individual (the venue owner, or one specific team member) wants the
 * email and/or SMS nudge when the concierge team hands a bride conversation
 * to the venue. The in-app message itself is unaffected either way; this
 * only gates the external notification.
 *
 * Owner prefs live on venues.owner_venue_direct_{email,sms}_enabled (one
 * owner per venue). Team-member prefs live on the member's own
 * venue_team_members row, so each person's setting is independent.
 */

interface Prefs { email: boolean; sms: boolean }

async function resolveIdentity() {
  const cookieStore = await cookies();
  const venueId  = cookieStore.get('venue_id')?.value;
  const memberId = cookieStore.get('member_id')?.value;
  if (!venueId) return null;
  return { venueId, memberId: memberId || null };
}

export async function GET() {
  const identity = await resolveIdentity();
  if (!identity) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (identity.memberId) {
    const { data, error } = await supabaseAdmin
      .from('venue_team_members')
      .select('venue_direct_email_enabled, venue_direct_sms_enabled')
      .eq('id', identity.memberId)
      .eq('venue_id', identity.venueId)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const row = data as { venue_direct_email_enabled?: boolean | null; venue_direct_sms_enabled?: boolean | null } | null;
    return NextResponse.json({
      email: row?.venue_direct_email_enabled !== false,
      sms:   row?.venue_direct_sms_enabled   !== false,
    } satisfies Prefs);
  }

  const { data, error } = await supabaseAdmin
    .from('venues')
    .select('owner_venue_direct_email_enabled, owner_venue_direct_sms_enabled')
    .eq('id', identity.venueId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const row = data as { owner_venue_direct_email_enabled?: boolean | null; owner_venue_direct_sms_enabled?: boolean | null } | null;
  return NextResponse.json({
    email: row?.owner_venue_direct_email_enabled !== false,
    sms:   row?.owner_venue_direct_sms_enabled   !== false,
  } satisfies Prefs);
}

export async function PUT(req: NextRequest) {
  const identity = await resolveIdentity();
  if (!identity) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Partial<Prefs>;
  try { body = (await req.json()) as Partial<Prefs>; } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (identity.memberId) {
    const update: Record<string, boolean> = {};
    if (typeof body.email === 'boolean') update.venue_direct_email_enabled = body.email;
    if (typeof body.sms   === 'boolean') update.venue_direct_sms_enabled   = body.sms;
    if (Object.keys(update).length === 0) return NextResponse.json({ error: 'No changes provided' }, { status: 400 });
    const { error } = await supabaseAdmin
      .from('venue_team_members')
      .update(update)
      .eq('id', identity.memberId)
      .eq('venue_id', identity.venueId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  const update: Record<string, boolean> = {};
  if (typeof body.email === 'boolean') update.owner_venue_direct_email_enabled = body.email;
  if (typeof body.sms   === 'boolean') update.owner_venue_direct_sms_enabled   = body.sms;
  if (Object.keys(update).length === 0) return NextResponse.json({ error: 'No changes provided' }, { status: 400 });
  const { error } = await supabaseAdmin
    .from('venues')
    .update(update)
    .eq('id', identity.venueId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
