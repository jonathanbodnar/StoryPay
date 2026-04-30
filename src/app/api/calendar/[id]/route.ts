import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { normalizeRule } from '@/lib/recurrence';
import { syncAppointmentRemindersForEvent } from '@/lib/appointment-reminders';
import { dispatchCalendarNotification, buildNotifVarsForEvent } from '@/lib/calendar-notifications';
import { pushEventUpdateToGoogle, pushEventDeleteToGoogle } from '@/lib/google-calendar-push';

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
    recurrence_rule, assigned_team_member_id, calendar_id,
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
  if ('calendar_id'       in body) updates.calendar_id       = calendar_id || null;
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

  // Push update to Google Calendar + dispatch notifications (fire-and-forget)
  if (row) {
    const eventRow = row as Record<string, unknown>;

    // Sync to Google whenever any user-visible field changed (title, time,
    // notes, status). Always derive a complete event body from the new row.
    const googleEventId   = (eventRow.google_event_id as string | null) ?? null;
    const googleCalendarId = (eventRow.google_calendar_id as string | null) ?? null;
    const isCancelled = updates.status === 'cancelled';

    void (async () => {
      try {
        const { data: calSettings } = await supabaseAdmin
          .from('venue_calendar_settings')
          .select('timezone')
          .eq('venue_id', venueId)
          .maybeSingle();
        const tz = (calSettings as { timezone?: string } | null)?.timezone ?? null;

        // Google Calendar push: cancellation deletes the event, otherwise patch.
        if (googleEventId) {
          if (isCancelled) {
            await pushEventDeleteToGoogle(venueId, {
              google_event_id: googleEventId,
              google_calendar_id: googleCalendarId,
            });
            await supabaseAdmin
              .from('calendar_events')
              .update({ google_event_id: null, google_calendar_id: null, google_html_link: null })
              .eq('id', id);
          } else {
            await pushEventUpdateToGoogle(
              venueId,
              { google_event_id: googleEventId, google_calendar_id: googleCalendarId },
              {
                title: String(eventRow.title ?? 'Appointment'),
                start_at: String(eventRow.start_at),
                end_at: String(eventRow.end_at),
                all_day: !!eventRow.all_day,
                notes: (eventRow.notes as string | null) ?? null,
                attendees: eventRow.customer_email ? [String(eventRow.customer_email)] : [],
                time_zone: tz,
              },
            );
          }
        }

        // Send cancellation / reschedule emails + SMS when relevant.
        const isRescheduled = !isCancelled && ('start_at' in updates || 'end_at' in updates);
        const customerEmail = (eventRow.customer_email as string | null)?.trim();
        if ((isCancelled || isRescheduled) && customerEmail) {
          const vars = await buildNotifVarsForEvent(
            {
              id,
              venue_id: venueId,
              title: String(eventRow.title ?? 'Appointment'),
              start_at: String(updates.start_at ?? eventRow.start_at),
              end_at: String(updates.end_at ?? eventRow.end_at ?? ''),
              customer_email: customerEmail,
            },
            tz ?? undefined,
          );
          if (vars) {
            const evCalId = (eventRow.calendar_id as string | null) ?? null;
            await dispatchCalendarNotification(
              venueId,
              isCancelled ? 'cancellation' : 'reschedule',
              vars,
              undefined,
              evCalId,
            );
          }
        }
      } catch (e) {
        console.error('[calendar PATCH] post-update side-effects error:', e);
      }
    })();
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

  // Fetch the event details + Google linkage BEFORE deleting so we can:
  //   1. Push the deletion to Google after the local row is gone.
  //   2. Fire a cancellation notification to the contact.
  type ExistingRow = {
    google_event_id?: string | null;
    google_calendar_id?: string | null;
    customer_email?: string | null;
    title?: string | null;
    start_at?: string | null;
    end_at?: string | null;
  };
  let existingEvent: ExistingRow | null = null;
  try {
    const { data } = await supabaseAdmin
      .from('calendar_events')
      .select('google_event_id, google_calendar_id, customer_email, title, start_at, end_at')
      .eq('id', id)
      .eq('venue_id', venueId)
      .maybeSingle();
    existingEvent = (data as ExistingRow | null) ?? null;
  } catch {
    // Column missing — migration not applied yet. Just skip Google sync and notifications.
  }

  const { error } = await supabaseAdmin
    .from('calendar_events')
    .delete()
    .eq('id', id)
    .eq('venue_id', venueId);

  if (error) {
    console.error('[calendar DELETE]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Fire post-delete side-effects (fire-and-forget — local delete already succeeded)
  void (async () => {
    try {
      // Push the delete to Google
      if (existingEvent?.google_event_id) {
        await pushEventDeleteToGoogle(venueId, {
          google_event_id: existingEvent.google_event_id ?? null,
          google_calendar_id: existingEvent.google_calendar_id ?? null,
        });
      }

      // Dispatch cancellation notification to the contact
      const customerEmail = existingEvent?.customer_email?.trim();
      if (customerEmail && existingEvent?.start_at) {
        const { data: calSettings } = await supabaseAdmin
          .from('venue_calendar_settings')
          .select('timezone')
          .eq('venue_id', venueId)
          .maybeSingle();
        const tz = (calSettings as { timezone?: string } | null)?.timezone ?? undefined;

        const vars = await buildNotifVarsForEvent(
          {
            id,
            venue_id: venueId,
            title: existingEvent.title ?? 'Appointment',
            start_at: existingEvent.start_at,
            end_at: existingEvent.end_at ?? undefined,
            customer_email: customerEmail,
          },
          tz,
        );
        if (vars) {
          await dispatchCalendarNotification(venueId, 'cancellation', vars, undefined, null);
        }
      }
    } catch (e) {
      console.error('[calendar DELETE] post-delete side-effects error:', e);
    }
  })();

  return NextResponse.json({ success: true });
}
