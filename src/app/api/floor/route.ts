import { NextRequest, NextResponse } from 'next/server';
import { formatInTimeZone } from 'date-fns-tz';
import { getVenueId } from '@/lib/auth-helpers';
import { supabaseAdmin } from '@/lib/supabase';
import { expandEvent, isRecurrenceRule, type RecurrenceRule } from '@/lib/recurrence';
import { resolveVenueTimezone, venueDayBoundsUtc } from '@/lib/venue-timezone';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type SpaceLite = { id: string; name: string; color: string };

function flattenSpace<T extends { venue_spaces?: SpaceLite | SpaceLite[] | null }>(row: T) {
  const v = row.venue_spaces;
  const flat = Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
  return { ...row, venue_spaces: flat };
}

function expandRows(rows: Array<Record<string, unknown>>, rangeStart: Date, rangeEnd: Date) {
  const out: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const baseStart = String(row.start_at);
    const baseEnd = String(row.end_at);
    const rule = isRecurrenceRule(row.recurrence_rule) ? (row.recurrence_rule as RecurrenceRule) : null;

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

export async function GET(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const q = request.nextUrl.searchParams.get('q')?.trim() ?? '';

  const { data: venue } = await supabaseAdmin.from('venues').select('timezone').eq('id', venueId).maybeSingle();
  const tz = resolveVenueTimezone(venue?.timezone as string | null);
  const ymd = formatInTimeZone(new Date(), tz, 'yyyy-MM-dd');
  const { start, end } = venueDayBoundsUtc(ymd, tz);
  const toIso = end.toISOString();

  let leadsQuery = supabaseAdmin
    .from('leads')
    .select('id, name, first_name, last_name, email, phone, wedding_date, stage_id')
    .eq('venue_id', venueId)
    .order('updated_at', { ascending: false })
    .limit(12);

  if (q.length >= 1) {
    const pat = `%${q}%`;
    leadsQuery = supabaseAdmin
      .from('leads')
      .select('id, name, first_name, last_name, email, phone, wedding_date, stage_id')
      .eq('venue_id', venueId)
      .or(
        [
          `first_name.ilike.${pat}`,
          `last_name.ilike.${pat}`,
          `name.ilike.${pat}`,
          `email.ilike.${pat}`,
          `phone.ilike.${pat}`,
        ].join(','),
      )
      .order('updated_at', { ascending: false })
      .limit(15);
  }

  const [{ data: leads, error: leErr }, { data: taskRows, error: teErr }] = await Promise.all([
    leadsQuery,
    supabaseAdmin
      .from('lead_tasks')
      .select('id, title, due_at, lead_id, leads(id, name, first_name, last_name, email)')
      .eq('venue_id', venueId)
      .is('completed_at', null)
      .order('due_at', { ascending: true, nullsFirst: false })
      .limit(25),
  ]);

  if (leErr) return NextResponse.json({ error: leErr.message }, { status: 500 });
  if (teErr) return NextResponse.json({ error: teErr.message }, { status: 500 });

  let calQuery = supabaseAdmin
    .from('calendar_events')
    .select('*, venue_spaces:space_id(id, name, color)')
    .eq('venue_id', venueId)
    .neq('status', 'cancelled')
    .lte('start_at', toIso)
    .order('start_at', { ascending: true });

  const { data: calRaw, error: calErr } = await calQuery;

  let expanded: Array<Record<string, unknown>>;
  if (calErr) {
    const { data: plain, error: pErr } = await supabaseAdmin
      .from('calendar_events')
      .select('*')
      .eq('venue_id', venueId)
      .neq('status', 'cancelled')
      .lte('start_at', toIso);
    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
    expanded = expandRows((plain ?? []).map(flattenSpace), start, end);
  } else {
    expanded = expandRows((calRaw ?? []).map(flattenSpace), start, end);
  }

  const toursToday = expanded.filter((e) => String(e.event_type) === 'tour');

  const tasks = (taskRows ?? []).map((t: Record<string, unknown>) => {
    const L = t.leads as Record<string, unknown> | Record<string, unknown>[] | null | undefined;
    const lead = Array.isArray(L) ? (L[0] ?? null) : (L ?? null);
    const { leads: _drop, ...rest } = t;
    return { ...rest, lead };
  });

  return NextResponse.json({
    venue_date: ymd,
    timezone: tz,
    leads: leads ?? [],
    tasks,
    tours_today: toursToday,
    agenda_today: expanded.slice(0, 40),
  });
}
