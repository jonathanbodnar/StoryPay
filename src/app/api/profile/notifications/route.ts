import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';
import { mergePersonNotificationSettings, DEFAULT_PERSON_NOTIFICATIONS } from '@/lib/notification-settings';

export const dynamic = 'force-dynamic';

/**
 * GET/PUT /api/profile/notifications
 *
 * Per-person email + SMS notification preferences — every owner/team alert
 * scenario (new lead, payment received/failed, bride handoff, proposal
 * signed, etc.) gets its own `email_<scenario>` / `sms_<scenario>` boolean
 * for THIS individual only (the venue owner, or one specific team member).
 * See src/lib/notification-settings.ts for the canonical scenario list and
 * src/lib/owner-notifications.ts for where these get read when deciding who
 * to actually notify.
 *
 * Owner prefs live on venues.notification_settings (one owner per venue).
 * Team-member prefs live on the member's own venue_team_members row, so
 * each person's settings are fully independent.
 *
 * Push is deliberately out of scope here — see PushNotificationsClientPage.tsx.
 */

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

  const table = identity.memberId ? 'venue_team_members' : 'venues';
  const idCol = identity.memberId ? 'id' : 'id';
  const idVal = identity.memberId ?? identity.venueId;

  let query = supabaseAdmin.from(table).select('notification_settings').eq(idCol, idVal);
  if (identity.memberId) query = query.eq('venue_id', identity.venueId);

  const { data, error } = await query.maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const row = data as { notification_settings?: unknown } | null;
  return NextResponse.json(mergePersonNotificationSettings(row?.notification_settings));
}

export async function PUT(req: NextRequest) {
  const identity = await resolveIdentity();
  if (!identity) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  // Only accept known keys with boolean values — anything else is dropped
  // silently rather than erroring, so the client can always PATCH a subset.
  const incoming = body as Record<string, unknown>;
  const patch: Record<string, boolean> = {};
  for (const key of Object.keys(DEFAULT_PERSON_NOTIFICATIONS)) {
    if (typeof incoming[key] === 'boolean') patch[key] = incoming[key] as boolean;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No valid settings provided' }, { status: 400 });
  }

  const table = identity.memberId ? 'venue_team_members' : 'venues';
  const idVal = identity.memberId ?? identity.venueId;

  let selectQuery = supabaseAdmin.from(table).select('notification_settings').eq('id', idVal);
  if (identity.memberId) selectQuery = selectQuery.eq('venue_id', identity.venueId);
  const { data: existing, error: selErr } = await selectQuery.maybeSingle();
  if (selErr) return NextResponse.json({ error: selErr.message }, { status: 500 });

  const current = mergePersonNotificationSettings((existing as { notification_settings?: unknown } | null)?.notification_settings);
  const next = { ...current, ...patch };

  let updateQuery = supabaseAdmin.from(table).update({ notification_settings: next }).eq('id', idVal);
  if (identity.memberId) updateQuery = updateQuery.eq('venue_id', identity.venueId);
  const { error: updErr } = await updateQuery;
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ success: true, settings: next });
}
