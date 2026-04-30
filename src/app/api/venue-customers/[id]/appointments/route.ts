import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { syncAppointmentRemindersForEvent } from '@/lib/appointment-reminders';
import { pushEventCreateToGoogle } from '@/lib/google-calendar-push';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const EVENT_TYPES = ['wedding','reception','tour','phone_call','tasting','meeting','rehearsal','hold','blocked','other'];

async function getContactEmail(venueId: string, customerId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('venue_customers')
    .select('customer_email')
    .eq('id', customerId)
    .eq('venue_id', venueId)
    .maybeSingle();
  const email = (data as { customer_email?: string | null } | null)?.customer_email?.trim() || null;
  return email && email.includes('@') && !email.endsWith('@storypay.internal') ? email : null;
}

/** GET — fetch upcoming + past calendar events linked to this contact. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: customerId } = await params;
  const email = await getContactEmail(venueId, customerId);
  if (!email) return NextResponse.json([]);

  const { data, error } = await supabaseAdmin
    .from('calendar_events')
    .select('id, title, event_type, start_at, end_at, all_day, notes, status, space_id, venue_spaces:space_id(id, name, color)')
    .eq('venue_id', venueId)
    .ilike('customer_email', email)
    .neq('status', 'cancelled')
    .order('start_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const flatten = (row: Record<string, unknown>) => {
    const vs = row.venue_spaces;
    return { ...row, venue_spaces: Array.isArray(vs) ? (vs[0] ?? null) : (vs ?? null) };
  };

  return NextResponse.json((data ?? []).map(flatten));
}

/** POST — schedule a new calendar appointment for this contact. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: customerId } = await params;
  const email = await getContactEmail(venueId, customerId);

  // Also fetch contact name for auto-title
  const { data: vc } = await supabaseAdmin
    .from('venue_customers')
    .select('first_name, last_name')
    .eq('id', customerId)
    .eq('venue_id', venueId)
    .maybeSingle();

  const body = await request.json() as {
    title?: string; event_type?: string; start_at: string; end_at: string;
    space_id?: string | null; all_day?: boolean; notes?: string;
  };

  if (!body.start_at || !body.end_at) return NextResponse.json({ error: 'start_at and end_at are required' }, { status: 400 });
  if (new Date(body.end_at) <= new Date(body.start_at)) return NextResponse.json({ error: 'end_at must be after start_at' }, { status: 400 });

  const eventType = body.event_type && EVENT_TYPES.includes(body.event_type) ? body.event_type : 'meeting';
  const contactName = [(vc as { first_name?: string } | null)?.first_name, (vc as { last_name?: string } | null)?.last_name].filter(Boolean).join(' ') || 'Contact';
  const title = body.title?.trim() || `${contactName} — ${eventType.replace(/_/g, ' ')}`;

  // Conflict check if space selected
  if (body.space_id) {
    const { data: conflicts } = await supabaseAdmin
      .from('calendar_events')
      .select('id, title, start_at, end_at')
      .eq('venue_id', venueId)
      .eq('space_id', body.space_id)
      .neq('status', 'cancelled')
      .lt('start_at', body.end_at)
      .gt('end_at', body.start_at);
    if ((conflicts ?? []).length > 0) {
      return NextResponse.json({ error: 'conflict', message: 'This space already has an event during that time.', conflicts }, { status: 409 });
    }
  }

  const { data: event, error } = await supabaseAdmin
    .from('calendar_events')
    .insert({
      venue_id:       venueId,
      space_id:       body.space_id || null,
      customer_email: email || null,
      title,
      event_type:     eventType,
      status:         'confirmed',
      start_at:       body.start_at,
      end_at:         body.end_at,
      all_day:        body.all_day ?? false,
      notes:          body.notes || null,
    })
    .select('id, title, event_type, start_at, end_at, all_day, notes, status, space_id')
    .single();

  if (error || !event) {
    console.error('[venue-customers appointments POST]', error);
    return NextResponse.json({ error: error?.message ?? 'Failed to create appointment' }, { status: 500 });
  }

  void syncAppointmentRemindersForEvent(event.id as string);

  // Push to Google Calendar (fire-and-forget) and persist the linkage so
  // future updates/deletes also sync.
  void (async () => {
    try {
      const { data: calSettings } = await supabaseAdmin
        .from('venue_calendar_settings')
        .select('timezone')
        .eq('venue_id', venueId)
        .maybeSingle();
      const tz = (calSettings as { timezone?: string } | null)?.timezone ?? null;
      const link = await pushEventCreateToGoogle(venueId, {
        title,
        start_at: body.start_at,
        end_at: body.end_at,
        all_day: !!body.all_day,
        notes: (body.notes as string | null) ?? null,
        attendees: email ? [email] : [],
        time_zone: tz,
      });
      if (link) {
        await supabaseAdmin
          .from('calendar_events')
          .update({
            google_event_id: link.google_event_id,
            google_calendar_id: link.google_calendar_id,
            google_html_link: link.html_link ?? null,
          })
          .eq('id', event.id as string);
      }
    } catch (e) {
      console.error('[venue-customers appointments] Google push failed:', e);
    }
  })();

  // Add an activity note so it shows in the timeline
  try {
    await supabaseAdmin.from('venue_customer_notes').insert({
      venue_customer_id: customerId,
      venue_id:          venueId,
      content:           `Appointment scheduled: ${title} on ${new Date(body.start_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}.`,
      author_name:       'system',
    });
  } catch { /* non-fatal */ }

  return NextResponse.json(event, { status: 201 });
}

/** DELETE — cancel a calendar event. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: customerId } = await params;
  const url = new URL(request.url);
  const eventId = url.searchParams.get('eventId');
  if (!eventId) return NextResponse.json({ error: 'eventId required' }, { status: 400 });

  // Verify the event belongs to this venue
  const { data: ev } = await supabaseAdmin
    .from('calendar_events')
    .select('id, customer_email')
    .eq('id', eventId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!ev) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { error } = await supabaseAdmin
    .from('calendar_events')
    .update({ status: 'cancelled' })
    .eq('id', eventId)
    .eq('venue_id', venueId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
