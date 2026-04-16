import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getDb } from '@/lib/db';
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
  const from   = new Date().toISOString();
  const to     = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();

  let events;
  try {
    events = await listScheduledEvents(token, orgUri, { from, to, count: 100 });
  } catch (err) {
    return NextResponse.json({ error: `Failed to fetch Calendly events: ${err instanceof Error ? err.message : err}` }, { status: 502 });
  }

  const sql = getDb();
  let created = 0, skipped = 0;

  for (const evt of events) {
    const calendlyEventId = evt.uri.split('/').pop()!;

    const existing = await sql`
      SELECT id FROM calendar_events
      WHERE venue_id = ${venueId} AND notes LIKE ${'%calendly_event_id:' + calendlyEventId + '%'}
      LIMIT 1
    `;
    if (existing.length > 0) { skipped++; continue; }

    const invitees       = await getEventInvitees(token, evt.uri);
    const primaryInvitee = invitees[0];
    const customerEmail  = primaryInvitee?.email ?? null;
    const eventTitle     = primaryInvitee?.name ? `${primaryInvitee.name} — ${evt.name}` : evt.name;
    const eventType      = mapEventType(evt.name);
    const evtStatus      = evt.status === 'canceled' ? 'cancelled' : 'confirmed';

    await sql`
      INSERT INTO calendar_events (venue_id, title, event_type, status, start_at, end_at, all_day, customer_email, notes)
      VALUES (${venueId}, ${eventTitle}, ${eventType}, ${evtStatus},
              ${evt.start_time}::timestamptz, ${evt.end_time}::timestamptz,
              false, ${customerEmail}, ${'Imported from Calendly\ncalendly_event_id:' + calendlyEventId})
    `;

    if (customerEmail) {
      const nameParts = (primaryInvitee?.name ?? '').trim().split(' ');
      await sql`
        INSERT INTO venue_customers (venue_id, customer_email, first_name, last_name, updated_at)
        VALUES (${venueId}, ${customerEmail.toLowerCase()}, ${nameParts[0] ?? ''}, ${nameParts.slice(1).join(' ')}, now())
        ON CONFLICT (venue_id, customer_email) DO UPDATE SET updated_at = now()
      `;
    }

    created++;
  }

  return NextResponse.json({ created, skipped, total: events.length });
}
