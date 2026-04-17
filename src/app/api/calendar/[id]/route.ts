import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { normalizeRule } from '@/lib/recurrence';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type SpaceLite = { id: string; name: string; color: string };

function flattenSpace<T extends { venue_spaces?: SpaceLite | SpaceLite[] | null }>(row: T) {
  const v = row.venue_spaces;
  const flat = Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
  return { ...row, venue_spaces: flat };
}

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
    recurrence_rule,
  } = body;

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
      .select('*, venue_spaces:space_id(id, name, color)')
      .eq('id', id)
      .eq('venue_id', venueId)
      .maybeSingle();
    return NextResponse.json(current ? flattenSpace(current) : null);
  }

  const { data: row, error } = await supabaseAdmin
    .from('calendar_events')
    .update(updates)
    .eq('id', id)
    .eq('venue_id', venueId)
    .select('*, venue_spaces:space_id(id, name, color)')
    .maybeSingle();

  if (error) {
    console.error('[calendar PATCH]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(row ? flattenSpace(row) : null);
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
