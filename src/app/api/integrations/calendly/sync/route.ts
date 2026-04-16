import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { listScheduledEvents, getEventInvitees, mapEventType } from '@/lib/calendly';

export async function POST() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('calendly_access_token, calendly_org_uri, calendly_connected')
    .eq('id', venueId)
    .single();

  if (!venue?.calendly_connected || !venue.calendly_access_token) {
    return NextResponse.json({ error: 'Calendly is not connected' }, { status: 400 });
  }

  const token  = venue.calendly_access_token;
  const orgUri = venue.calendly_org_uri;

  // Import upcoming events from now → 6 months out
  const from = new Date().toISOString();
  const to   = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();

  let events;
  try {
    events = await listScheduledEvents(token, orgUri, { from, to, count: 100 });
  } catch (err) {
    return NextResponse.json({ error: `Failed to fetch Calendly events: ${err instanceof Error ? err.message : err}` }, { status: 502 });
  }

  let created = 0;
  let skipped = 0;

  for (const evt of events) {
    const calendlyEventId = evt.uri.split('/').pop()!;

    // Check if already imported (we store the calendly event URI in notes field)
    const { data: existing } = await supabaseAdmin
      .from('calendar_events')
      .select('id')
      .eq('venue_id', venueId)
      .like('notes', `%calendly_event_id:${calendlyEventId}%`)
      .maybeSingle();

    if (existing) { skipped++; continue; }

    // Fetch the first invitee for customer email
    const invitees = await getEventInvitees(token, evt.uri);
    const primaryInvitee = invitees[0];
    const customerEmail  = primaryInvitee?.email ?? null;
    const eventTitle     = primaryInvitee?.name
      ? `${primaryInvitee.name} — ${evt.name}`
      : evt.name;

    const eventType = mapEventType(evt.name);

    await supabaseAdmin.from('calendar_events').insert({
      venue_id:       venueId,
      title:          eventTitle,
      event_type:     eventType,
      status:         evt.status === 'canceled' ? 'cancelled' : 'confirmed',
      start_at:       evt.start_time,
      end_at:         evt.end_time,
      all_day:        false,
      customer_email: customerEmail,
      notes:          `Imported from Calendly\ncalendly_event_id:${calendlyEventId}`,
    });

    // Auto-create / update local venue_customer record
    if (customerEmail) {
      const nameParts = (primaryInvitee?.name ?? '').trim().split(' ');
      const firstName = nameParts[0] ?? '';
      const lastName  = nameParts.slice(1).join(' ');
      await supabaseAdmin
        .from('venue_customers')
        .upsert(
          {
            venue_id: venueId,
            customer_email: customerEmail.toLowerCase(),
            first_name: firstName,
            last_name:  lastName,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'venue_id,customer_email', ignoreDuplicates: false }
        );
    }

    created++;
  }

  return NextResponse.json({ created, skipped, total: events.length });
}
