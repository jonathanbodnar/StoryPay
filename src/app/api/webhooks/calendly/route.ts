import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
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

  const eventType = payload.event as string;       // 'invitee.created' | 'invitee.canceled'
  const invitee   = payload.payload as Record<string, unknown> | undefined;

  if (!invitee) return NextResponse.json({ received: true });

  // Calendly sends the event (scheduled_event) nested inside payload
  const scheduledEvent  = invitee.scheduled_event as Record<string, unknown> | undefined;
  const inviteeEmail    = invitee.email as string | undefined;
  const inviteeName     = invitee.name as string | undefined;
  const eventUri        = scheduledEvent?.uri as string | undefined;
  const startTime       = scheduledEvent?.start_time as string | undefined;
  const endTime         = scheduledEvent?.end_time as string | undefined;
  const eventName       = scheduledEvent?.name as string | undefined;
  const orgUri          = (scheduledEvent?.organization as string | undefined) ?? '';

  if (!eventUri || !startTime || !endTime) {
    console.warn('[calendly webhook] missing event fields', JSON.stringify(payload).slice(0, 500));
    return NextResponse.json({ received: true });
  }

  const calendlyEventId = eventUri.split('/').pop()!;

  // Find the venue that owns this org URI
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id')
    .eq('calendly_org_uri', orgUri)
    .eq('calendly_connected', true)
    .maybeSingle();

  if (!venue) {
    // Org URI not matched — might be a test ping or unconnected venue
    console.warn('[calendly webhook] no venue found for org:', orgUri);
    return NextResponse.json({ received: true });
  }

  const venueId = venue.id;

  if (eventType === 'invitee.created') {
    // Check for duplicate (idempotency)
    const { data: existing } = await supabaseAdmin
      .from('calendar_events')
      .select('id')
      .eq('venue_id', venueId)
      .like('notes', `%calendly_event_id:${calendlyEventId}%`)
      .maybeSingle();

    if (!existing) {
      const nameParts  = (inviteeName ?? '').trim().split(' ');
      const firstName  = nameParts[0] ?? '';
      const lastName   = nameParts.slice(1).join(' ');
      const title      = inviteeName ? `${inviteeName} — ${eventName ?? 'Booking'}` : (eventName ?? 'Calendly Booking');
      const evtType    = mapEventType(eventName ?? '');

      await supabaseAdmin.from('calendar_events').insert({
        venue_id:       venueId,
        title,
        event_type:     evtType,
        status:         'confirmed',
        start_at:       startTime,
        end_at:         endTime,
        all_day:        false,
        customer_email: inviteeEmail ?? null,
        notes:          `Booked via Calendly\ncalendly_event_id:${calendlyEventId}`,
      });

      // Upsert venue_customer record
      if (inviteeEmail) {
        await supabaseAdmin
          .from('venue_customers')
          .upsert(
            {
              venue_id: venueId,
              customer_email: inviteeEmail.toLowerCase(),
              first_name: firstName,
              last_name:  lastName,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'venue_id,customer_email', ignoreDuplicates: false }
          );

        // Log activity if customer record exists
        const { data: vc } = await supabaseAdmin
          .from('venue_customers')
          .select('id')
          .eq('venue_id', venueId)
          .eq('customer_email', inviteeEmail.toLowerCase())
          .maybeSingle();

        if (vc) {
          await supabaseAdmin.from('customer_activity').insert({
            venue_id:      venueId,
            customer_id:   vc.id,
            activity_type: 'event_created',
            title:         'Calendly booking received',
            description:   `${eventName ?? 'Event'} on ${new Date(startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
          });
        }
      }
    }

  } else if (eventType === 'invitee.canceled') {
    // Mark the matching calendar event as cancelled
    await supabaseAdmin
      .from('calendar_events')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('venue_id', venueId)
      .like('notes', `%calendly_event_id:${calendlyEventId}%`);
  }

  return NextResponse.json({ received: true });
}
