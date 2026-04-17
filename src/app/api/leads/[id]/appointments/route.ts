import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

const EVENT_TYPES = new Set([
  'wedding', 'reception', 'tour', 'tasting',
  'meeting', 'rehearsal', 'hold', 'blocked', 'other',
]);

/**
 * POST /api/leads/[id]/appointments
 *   body: {
 *     title?:       string,   // auto-built from the lead's name if omitted
 *     event_type?:  string,   // defaults to "tour" — that's what 90% of
 *                             // leads-calendar interactions are
 *     start_at:     string,   // ISO
 *     end_at:       string,   // ISO
 *     space_id?:    string,
 *     all_day?:     boolean,
 *     notes?:       string,
 *   }
 *
 * Schedules a calendar event tied to this lead. The event is also stamped
 * with the lead's email so the existing calendar→customer linking logic
 * continues to work.
 *
 * After successfully scheduling, we auto-append a timestamped note to the
 * lead so the appointment shows up in the lead's activity thread. We also
 * bump the lead into the "Tour Booked" stage if that stage exists on their
 * pipeline and the caller used the default event type.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: leadId } = await context.params;

  let body: {
    title?: string;
    event_type?: string;
    start_at?: string;
    end_at?: string;
    space_id?: string | null;
    all_day?: boolean;
    notes?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { start_at, end_at } = body;
  if (!start_at || !end_at) {
    return NextResponse.json({ error: 'start_at and end_at are required' }, { status: 400 });
  }
  if (new Date(end_at) <= new Date(start_at)) {
    return NextResponse.json({ error: 'end_at must be after start_at' }, { status: 400 });
  }

  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('id, name, first_name, last_name, email, pipeline_id, stage_id')
    .eq('id', leadId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

  const eventType = body.event_type && EVENT_TYPES.has(body.event_type) ? body.event_type : 'tour';
  const displayName =
    [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() ||
    lead.name ||
    'Lead';
  const title = body.title?.trim() || `${displayName} — ${eventType}`;

  // Reuse the calendar conflict check.
  if (body.space_id) {
    const { data: conflicts } = await supabaseAdmin
      .from('calendar_events')
      .select('id, title, start_at, end_at')
      .eq('venue_id', venueId)
      .eq('space_id', body.space_id)
      .neq('status', 'cancelled')
      .lt('start_at', end_at)
      .gt('end_at', start_at);
    if ((conflicts ?? []).length > 0) {
      return NextResponse.json({
        error: 'conflict',
        message: 'This space already has an event during that time.',
        conflicts,
      }, { status: 409 });
    }
  }

  const { data: event, error } = await supabaseAdmin
    .from('calendar_events')
    .insert({
      venue_id:       venueId,
      space_id:       body.space_id || null,
      customer_email: lead.email || null,
      title,
      event_type:     eventType,
      status:         'confirmed',
      start_at,
      end_at,
      all_day:        body.all_day ?? false,
      notes:          body.notes || `Scheduled from lead: ${displayName}`,
    })
    .select('*')
    .single();

  if (error || !event) {
    console.error('[POST /api/leads/[id]/appointments] failed:', error);
    return NextResponse.json({ error: error?.message ?? 'Failed to schedule appointment' }, { status: 500 });
  }

  // Auto-add a timestamped note so the activity thread shows the scheduling.
  const when = new Date(start_at).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  await supabaseAdmin.from('lead_notes').insert({
    lead_id:     leadId,
    venue_id:    venueId,
    content:     `Appointment scheduled (${eventType}) for ${when}.`,
    author_name: 'system',
  });

  // If the user scheduled a tour and the lead has a "Tour Booked" stage,
  // auto-advance them. We keep this narrow (only for `tour`) so unrelated
  // appointments don't silently move cards around.
  if (eventType === 'tour' && lead.pipeline_id) {
    const { data: tourStage } = await supabaseAdmin
      .from('lead_pipeline_stages')
      .select('id, name')
      .eq('pipeline_id', lead.pipeline_id)
      .eq('venue_id', venueId)
      .ilike('name', 'tour booked')
      .maybeSingle();
    if (tourStage && tourStage.id !== lead.stage_id) {
      await supabaseAdmin
        .from('leads')
        .update({ stage_id: tourStage.id, status: 'tour_booked' })
        .eq('id', leadId)
        .eq('venue_id', venueId);
    }
  }

  return NextResponse.json({ event });
}
