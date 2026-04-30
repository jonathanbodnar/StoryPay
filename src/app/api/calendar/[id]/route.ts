import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { normalizeRule } from '@/lib/recurrence';
import { syncAppointmentRemindersForEvent } from '@/lib/appointment-reminders';
import { dispatchCalendarNotification, type CalendarNotifVars } from '@/lib/calendar-notifications';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type SpaceLite = { id: string; name: string; color: string };
type TeamMemberLite = { id: string; name: string | null; first_name: string | null; last_name: string | null; email: string | null };

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

const CAL_EVENT_SELECT =
  '*, venue_spaces:space_id(id, name, color), venue_team_members:assigned_team_member_id(id, name, first_name, last_name, email)';

// Occurrences come back from GET with a synthetic id like
// `<uuid>@YYYY-MM-DD`. Edits/deletes apply to the parent series as the MVP
// contract, so strip the suffix before hitting the DB.
function parentIdOf(id: string): string {
  const at = id.indexOf('@');
  return at === -1 ? id : id.slice(0, at);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: rawId } = await params;
  const id = parentIdOf(rawId);

  const body = await request.json();
  const {
    space_id, customer_email, title, event_type, status,
    start_at, end_at, all_day, notes, override_conflict,
    recurrence_rule, assigned_team_member_id,
  } = body;
  // Silence unused warnings — assigned_team_member_id is referenced via the
  // `in body` check below so we just discard the destructured value here.
  void assigned_team_member_id;

  // Conflict detection on reschedule: pull the current start/end for columns
  // that weren't submitted in this patch, then check the same-space window.
  if (space_id && !override_conflict && (start_at || end_at)) {
    const { data: current, error: curErr } = await supabaseAdmin
      .from('calendar_events')
      .select('start_at, end_at')
      .eq('id', id)
      .eq('venue_id', venueId)
      .maybeSingle();
    if (curErr) {
      console.error('[calendar PATCH current]', curErr);
      return NextResponse.json({ error: curErr.message }, { status: 500 });
    }
    const newStart = start_at ?? current?.start_at;
    const newEnd   = end_at   ?? current?.end_at;
    if (newStart && newEnd) {
      const { data: conflicts, error: conflictErr } = await supabaseAdmin
        .from('calendar_events')
        .select('id, title, start_at, end_at')
        .eq('venue_id', venueId)
        .eq('space_id', space_id)
        .neq('status', 'cancelled')
        .neq('id', id)
        .lt('start_at', newEnd)
        .gt('end_at', newStart);
      if (conflictErr) {
        console.error('[calendar PATCH conflict]', conflictErr);
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
  }

  const updates: Record<string, unknown> = {};
  if ('space_id'          in body) updates.space_id          = space_id || null;
  if ('customer_email'    in body) updates.customer_email    = customer_email || null;
  if ('title'             in body) updates.title             = title?.trim() || title;
  if ('event_type'        in body) updates.event_type        = event_type;
  if ('status'            in body) updates.status            = status;
  if ('start_at'          in body) updates.start_at          = start_at || null;
  if ('end_at'            in body) updates.end_at            = end_at   || null;
  if ('all_day'           in body) updates.all_day           = all_day ?? false;
  if ('notes'             in body) updates.notes             = notes || null;
  if ('override_conflict' in body) updates.override_conflict = override_conflict ?? false;
  if ('assigned_team_member_id' in body) {
    updates.assigned_team_member_id = body.assigned_team_member_id || null;
  }
  if ('recurrence_rule'   in body) {
    // `null` explicitly clears the rule; anything else must normalize cleanly.
    if (recurrence_rule === null) {
      updates.recurrence_rule = null;
    } else {
      const normalized = normalizeRule(recurrence_rule);
      if (!normalized) {
        return NextResponse.json({ error: 'Invalid recurrence_rule' }, { status: 400 });
      }
      updates.recurrence_rule = normalized;
    }
  }

  if (Object.keys(updates).length === 0) {
    const { data: current } = await supabaseAdmin
      .from('calendar_events')
      .select(CAL_EVENT_SELECT)
      .eq('id', id)
      .eq('venue_id', venueId)
      .maybeSingle();
    if (current) return NextResponse.json(flattenRow(current));
    // Fallback for stale schemas without migration 047.
    const { data: plain } = await supabaseAdmin
      .from('calendar_events')
      .select('*, venue_spaces:space_id(id, name, color)')
      .eq('id', id)
      .eq('venue_id', venueId)
      .maybeSingle();
    return NextResponse.json(plain ? flattenRow(plain) : null);
  }

  // Try the full update (including the new team-member FK embed) — if that
  // fails because migration 047 hasn't been applied, drop the FK fields and
  // retry so venues on stale schemas can still save events.
  type RowShape = {
    venue_spaces?: SpaceLite | SpaceLite[] | null;
    venue_team_members?: TeamMemberLite | TeamMemberLite[] | null;
  } & Record<string, unknown>;

  let row: RowShape | null = null;
  let error: { message: string } | null = null;
  {
    const res = await supabaseAdmin
      .from('calendar_events')
      .update(updates)
      .eq('id', id)
      .eq('venue_id', venueId)
      .select(CAL_EVENT_SELECT)
      .maybeSingle();
    row = (res.data as RowShape | null) ?? null;
    error = res.error ?? null;
  }
  if (error && /assigned_team_member_id|venue_team_members/i.test(error.message)) {
    const safe = { ...updates };
    delete safe.assigned_team_member_id;
    const retry = await supabaseAdmin
      .from('calendar_events')
      .update(safe)
      .eq('id', id)
      .eq('venue_id', venueId)
      .select('*, venue_spaces:space_id(id, name, color)')
      .maybeSingle();
    row = (retry.data as RowShape | null) ?? null;
    error = retry.error ?? null;
  }

  if (error) {
    console.error('[calendar PATCH]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  void syncAppointmentRemindersForEvent(id);

  // Fire cancellation or reschedule notification (fire-and-forget)
  if (row) {
    const eventRow = row as Record<string, unknown>;
    const isCancelled = updates.status === 'cancelled';
    const isRescheduled = !isCancelled && ('start_at' in updates || 'end_at' in updates);

    if (isCancelled || isRescheduled) {
      void (async () => {
        try {
          const customerEmail = eventRow.customer_email as string | null;
          if (!customerEmail) return;

          const { data: contact } = await supabaseAdmin
            .from('venue_customers')
            .select('first_name,last_name,phone,ghl_contact_id')
            .eq('venue_id', venueId)
            .ilike('email', customerEmail)
            .maybeSingle();

          const { data: calSettings } = await supabaseAdmin
            .from('venue_calendar_settings')
            .select('timezone')
            .eq('venue_id', venueId)
            .maybeSingle();

          const tz = (calSettings as { timezone?: string } | null)?.timezone ?? 'America/New_York';
          const startAt = (updates.start_at ?? eventRow.start_at) as string;
          const startFormatted = new Intl.DateTimeFormat('en-US', {
            weekday: 'long', month: 'long', day: 'numeric',
            hour: 'numeric', minute: '2-digit', timeZone: tz,
          }).format(new Date(startAt));
          const tzLabel = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
            .formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value ?? tz;

          const c = contact as { first_name?: string; last_name?: string; phone?: string; ghl_contact_id?: string } | null;
          const contactName = [c?.first_name, c?.last_name].filter(Boolean).join(' ') || customerEmail;

          const vars: CalendarNotifVars = {
            contact_name: contactName,
            contact_email: customerEmail,
            contact_phone: c?.phone ?? null,
            contact_ghl_id: c?.ghl_contact_id ?? null,
            appointment_title: String(eventRow.title ?? 'Appointment'),
            appointment_start_time: startFormatted,
            appointment_timezone: tzLabel,
            appointment_meeting_location: null,
          };

          await dispatchCalendarNotification(venueId, isCancelled ? 'cancellation' : 'reschedule', vars);
        } catch (e) {
          console.error('[calendar PATCH] notification dispatch error:', e);
        }
      })();
    }
  }

  return NextResponse.json(row ? flattenRow(row) : null);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: rawId } = await params;
  const id = parentIdOf(rawId);

  const { error } = await supabaseAdmin
    .from('calendar_events')
    .delete()
    .eq('id', id)
    .eq('venue_id', venueId);

  if (error) {
    console.error('[calendar DELETE]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
