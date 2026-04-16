import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getDb } from '@/lib/db';
import { mapEventType } from '@/lib/calendly';

export async function GET() {
  return NextResponse.json({ status: 'ok' });
}

export async function POST(request: NextRequest) {
  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const eventType      = payload.event as string;
  const invitee        = payload.payload as Record<string, unknown> | undefined;
  if (!invitee) return NextResponse.json({ received: true });

  const scheduledEvent = invitee.scheduled_event as Record<string, unknown> | undefined;
  const inviteeEmail   = invitee.email as string | undefined;
  const inviteeName    = invitee.name  as string | undefined;
  const eventUri       = scheduledEvent?.uri       as string | undefined;
  const startTime      = scheduledEvent?.start_time as string | undefined;
  const endTime        = scheduledEvent?.end_time   as string | undefined;
  const eventName      = scheduledEvent?.name       as string | undefined;
  const orgUri         = (scheduledEvent?.organization as string | undefined) ?? '';

  if (!eventUri || !startTime || !endTime) {
    console.warn('[calendly webhook] missing fields', JSON.stringify(payload).slice(0, 300));
    return NextResponse.json({ received: true });
  }

  const calendlyEventId = eventUri.split('/').pop()!;

  // venues table is fine via supabaseAdmin (not a new table)
  const { data: venue } = await supabaseAdmin
    .from('venues').select('id').eq('calendly_org_uri', orgUri).eq('calendly_connected', true).maybeSingle();

  if (!venue) return NextResponse.json({ received: true });
  const venueId = venue.id;

  try {
    const sql = getDb();

    if (eventType === 'invitee.created') {
      const existing = await sql`
        SELECT id FROM calendar_events
        WHERE venue_id = ${venueId} AND notes LIKE ${'%calendly_event_id:' + calendlyEventId + '%'}
        LIMIT 1
      `;
      if (existing.length === 0) {
        const nameParts = (inviteeName ?? '').trim().split(' ');
        const firstName = nameParts[0] ?? '';
        const lastName  = nameParts.slice(1).join(' ');
        const title     = inviteeName ? `${inviteeName} — ${eventName ?? 'Booking'}` : (eventName ?? 'Calendly Booking');
        const evtType   = mapEventType(eventName ?? '');

        await sql`
          INSERT INTO calendar_events (venue_id, title, event_type, status, start_at, end_at, all_day, customer_email, notes)
          VALUES (${venueId}, ${title}, ${evtType}, 'confirmed', ${startTime}::timestamptz, ${endTime}::timestamptz,
                  false, ${inviteeEmail ?? null}, ${'Booked via Calendly\ncalendly_event_id:' + calendlyEventId})
        `;

        if (inviteeEmail) {
          await sql`
            INSERT INTO venue_customers (venue_id, customer_email, first_name, last_name, updated_at)
            VALUES (${venueId}, ${inviteeEmail.toLowerCase()}, ${firstName}, ${lastName}, now())
            ON CONFLICT (venue_id, customer_email) DO UPDATE SET updated_at = now()
          `;
          const [vc] = await sql`
            SELECT id FROM venue_customers WHERE venue_id = ${venueId} AND customer_email = ${inviteeEmail.toLowerCase()}
          `;
          if (vc) {
            await sql`
              INSERT INTO customer_activity (venue_id, customer_id, activity_type, title, description)
              VALUES (${venueId}, ${vc.id}, 'event_created', 'Calendly booking received',
                      ${`${eventName ?? 'Event'} on ${new Date(startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`})
            `;
          }
        }
      }
    } else if (eventType === 'invitee.canceled') {
      await sql`
        UPDATE calendar_events
        SET status = 'cancelled', updated_at = now()
        WHERE venue_id = ${venueId} AND notes LIKE ${'%calendly_event_id:' + calendlyEventId + '%'}
      `;
    }
  } catch (err) {
    console.error('[calendly webhook] db error:', err);
  }

  return NextResponse.json({ received: true });
}
