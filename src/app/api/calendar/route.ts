import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import {
  expandEvent,
  isRecurrenceRule,
  normalizeRule,
  type RecurrenceRule,
} from '@/lib/recurrence';
import { syncAppointmentRemindersForEvent } from '@/lib/appointment-reminders';
import { dispatchCalendarNotification, type CalendarNotifVars } from '@/lib/calendar-notifications';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type SpaceLite = { id: string; name: string; color: string };
type TeamMemberLite = { id: string; name: string | null; first_name: string | null; last_name: string | null; email: string | null };

// supabase-js returns a nested object when selecting a FK join. Normalize that
// to the single-row shape the UI expects: `venue_spaces: { id, name, color } | null`
function flattenRow<T extends {
  venue_spaces?: SpaceLite | SpaceLite[] | null;
  venue_team_members?: TeamMemberLite | TeamMemberLite[] | null;
}>(row: T) {
  const v = row.venue_spaces;
  const flatSpace = Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
  const t = row.venue_team_members;
  const flatTeam = Array.isArray(t) ? (t[0] ?? null) : (t ?? null);
  return { ...row, venue_spaces: flatSpace, venue_team_members: flatTeam };
}

// Select list used for reads + returning inserts. The team-member join is
// optional — if the migration hasn't run yet or the FK doesn't resolve we
// fall back to a plain select in the caller.
const CAL_EVENT_SELECT =
  '*, venue_spaces:space_id(id, name, color), venue_team_members:assigned_team_member_id(id, name, first_name, last_name, email)';

export async function GET(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = request.nextUrl;
  const from = searchParams.get('from');
  const to   = searchParams.get('to');

  // We fetch the superset of rows that *could* contribute occurrences to the
  // visible window, then filter/expand in-code. A recurring event might have
  // been created years ago but still produce occurrences today, so we can't
  // use the old simple `.gte('start_at', from)` filter anymore.
  let query = supabaseAdmin
    .from('calendar_events')
    .select(CAL_EVENT_SELECT)
    .eq('venue_id', venueId)
    .neq('status', 'cancelled')
    .order('start_at', { ascending: true });

  // Upper bound still applies — an event starting after `to` can't appear in
  // the window. We intentionally don't add a lower bound here so recurring
  // events whose base row is old still come through.
  if (to) query = query.lte('start_at', to);

  const { data, error } = await query;

  if (error) {
    // Migration 047 may not be applied yet, or PostgREST's FK cache is stale.
    // Retry with just the space embed first; if that also fails drop all
    // embeds and do a plain select.
    console.error('[calendar GET]', error);
    let fallback = supabaseAdmin
      .from('calendar_events')
      .select('*, venue_spaces:space_id(id, name, color)')
      .eq('venue_id', venueId)
      .neq('status', 'cancelled')
      .order('start_at', { ascending: true });
    if (to) fallback = fallback.lte('start_at', to);
    const fbRes = await fallback;
    if (!fbRes.error) {
      return NextResponse.json(expandRows((fbRes.data ?? []).map(flattenRow), from, to));
    }
    let plain = supabaseAdmin
      .from('calendar_events')
      .select('*')
      .eq('venue_id', venueId)
      .neq('status', 'cancelled')
      .order('start_at', { ascending: true });
    if (to) plain = plain.lte('start_at', to);
    const { data: rows, error: plainErr } = await plain;
    if (plainErr) return NextResponse.json({ error: plainErr.message }, { status: 500 });
    return NextResponse.json(expandRows(rows ?? [], from, to));
  }

  return NextResponse.json(expandRows((data ?? []).map(flattenRow), from, to));
}

// Expand every row into the set of occurrences that land in [from, to].
// For non-recurring rows, also filter out events whose end_at falls before
// the window (the SQL query doesn't handle that because it only bounds
// start_at, so a multi-day event ending before `from` could leak through if
// it started within the window — but we prefer to keep the query simple).
function expandRows(rows: Array<Record<string, unknown>>, from: string | null, to: string | null) {
  const rangeStart = from ? new Date(from) : new Date(-8640000000000000); // min date
  const rangeEnd   = to   ? new Date(to)   : new Date( 8640000000000000); // max date

  const out: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const baseStart = String(row.start_at);
    const baseEnd   = String(row.end_at);
    const rule = isRecurrenceRule(row.recurrence_rule)
      ? row.recurrence_rule as RecurrenceRule
      : null;

    const occurrences = expandEvent(
      { id: String(row.id), start_at: baseStart, end_at: baseEnd, recurrence_rule: rule },
      rangeStart,
      rangeEnd,
    );

    for (const occ of occurrences) {
      out.push({
        ...row,
        id: occ.id,
        parent_id: occ.parent_id,
        start_at: occ.start_at,
        end_at: occ.end_at,
        is_occurrence: occ.is_occurrence,
      });
    }
  }
  out.sort((a, b) => String(a.start_at).localeCompare(String(b.start_at)));
  return out;
}

export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const {
    space_id, customer_email, title, event_type, status,
    start_at, end_at, all_day, proposal_id, notes, override_conflict,
    recurrence_rule, assigned_team_member_id,
  } = body;

  if (!title?.trim()) return NextResponse.json({ error: 'Title is required' }, { status: 400 });
  if (!start_at || !end_at) return NextResponse.json({ error: 'start_at and end_at are required' }, { status: 400 });
  if (new Date(end_at) <= new Date(start_at)) {
    return NextResponse.json({ error: 'end_at must be after start_at' }, { status: 400 });
  }

  const rule = recurrence_rule ? normalizeRule(recurrence_rule) : null;
  // User sent a rule but it was malformed — bail loudly instead of silently
  // dropping it, otherwise they'd create a one-off without realizing.
  if (recurrence_rule && !rule) {
    return NextResponse.json({ error: 'Invalid recurrence_rule' }, { status: 400 });
  }

  // Conflict detection only checks the first occurrence — recurring conflicts
  // across months are expensive to compute and almost never what the user
  // actually wants warned about at create time.
  if (space_id && !override_conflict) {
    const { data: conflicts, error: conflictErr } = await supabaseAdmin
      .from('calendar_events')
      .select('id, title, start_at, end_at')
      .eq('venue_id', venueId)
      .eq('space_id', space_id)
      .neq('status', 'cancelled')
      .lt('start_at', end_at)
      .gt('end_at', start_at);
    if (conflictErr) {
      console.error('[calendar POST conflict]', conflictErr);
      return NextResponse.json({ error: conflictErr.message }, { status: 500 });
    }
    if ((conflicts ?? []).length > 0) {
      return NextResponse.json({
        error: 'conflict',
        message: 'This space already has an event during that time.',
        conflicts,
      }, { status: 409 });
    }
  }

  // Assigned team-member FK is optional and guarded because the column was
  // added in migration 047. If that migration hasn't run yet we silently
  // strip the field so the insert keeps working on older schemas.
  const insertPayload: Record<string, unknown> = {
    venue_id:          venueId,
    space_id:          space_id || null,
    customer_email:    customer_email || null,
    title:             title.trim(),
    event_type:        event_type || 'other',
    status:            status || 'confirmed',
    start_at,
    end_at,
    all_day:           all_day ?? false,
    proposal_id:       proposal_id || null,
    notes:             notes || null,
    override_conflict: override_conflict ?? false,
    recurrence_rule:   rule,
  };
  if (assigned_team_member_id !== undefined) {
    insertPayload.assigned_team_member_id = assigned_team_member_id || null;
  }

  let row: Record<string, unknown> | null = null;
  let error: { message: string } | null = null;
  {
    const res = await supabaseAdmin
      .from('calendar_events')
      .insert(insertPayload)
      .select(CAL_EVENT_SELECT)
      .single();
    row = res.data as Record<string, unknown> | null;
    error = res.error ?? null;
  }

  // Migration 047 adds `assigned_team_member_id`. On older DBs the insert or
  // the FK embed will fail — retry without that column / embed so venues on
  // stale schemas can still create events.
  if (error && /assigned_team_member_id|venue_team_members/i.test(error.message)) {
    delete insertPayload.assigned_team_member_id;
    const retry = await supabaseAdmin
      .from('calendar_events')
      .insert(insertPayload)
      .select('*, venue_spaces:space_id(id, name, color)')
      .single();
    row = retry.data as Record<string, unknown> | null;
    error = retry.error ?? null;
  }

  if (error || !row) {
    console.error('[calendar POST insert]', error);
    return NextResponse.json({ error: error?.message ?? 'Failed to create event' }, { status: 500 });
  }

  void syncAppointmentRemindersForEvent(String((row as { id: string }).id));

  // Fire booked_confirmed notification (fire-and-forget)
  if ((status ?? 'confirmed') === 'confirmed' && customer_email) {
    void (async () => {
      try {
        const { data: contact } = await supabaseAdmin
          .from('venue_customers')
          .select('first_name,last_name,phone,ghl_contact_id')
          .eq('venue_id', venueId)
          .ilike('email', customer_email as string)
          .maybeSingle();

        const { data: calSettings } = await supabaseAdmin
          .from('venue_calendar_settings')
          .select('timezone')
          .eq('venue_id', venueId)
          .maybeSingle();

        const tz = (calSettings as { timezone?: string } | null)?.timezone ?? 'America/New_York';
        const startFormatted = new Intl.DateTimeFormat('en-US', {
          weekday: 'long', month: 'long', day: 'numeric',
          hour: 'numeric', minute: '2-digit', timeZone: tz,
        }).format(new Date(start_at as string));
        const tzLabel = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
          .formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value ?? tz;

        const c = contact as { first_name?: string; last_name?: string; phone?: string; ghl_contact_id?: string } | null;
        const contactName = [c?.first_name, c?.last_name].filter(Boolean).join(' ') || (customer_email as string);

        const vars: CalendarNotifVars = {
          contact_name: contactName,
          contact_email: customer_email as string,
          contact_phone: c?.phone ?? null,
          contact_ghl_id: c?.ghl_contact_id ?? null,
          appointment_title: (title as string).trim(),
          appointment_start_time: startFormatted,
          appointment_timezone: tzLabel,
          appointment_meeting_location: null,
        };
        await dispatchCalendarNotification(venueId, 'booked_confirmed', vars);
      } catch (e) {
        console.error('[calendar POST] notification dispatch error:', e);
      }
    })();
  }

  return NextResponse.json(flattenRow(row as Parameters<typeof flattenRow>[0]), { status: 201 });
}
