import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getDb } from '@/lib/db';
import { mapEventType, verifyCalendlySignature } from '@/lib/calendly';
import { ensureDefaultPipeline } from '@/lib/pipelines';
import { notifyOwnerNewLead } from '@/lib/owner-notifications';
import { handOffNewLead } from '@/lib/new-lead-handoffs';

// Soft-enforcement rollout: existing subscriptions predate signing-key support
// and won't have a stored key until /api/admin/resubscribe-calendly-signing-keys
// has run for them. Until that backfill is confirmed complete, log-only so
// calendar sync doesn't silently break; flip to '1' once confirmed.
const ENFORCE_SIGNATURE = process.env.CALENDLY_WEBHOOK_ENFORCE_SIGNATURE === '1';

export async function GET() {
  return NextResponse.json({ status: 'ok' });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
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

  // The venue this Calendly organization belongs to. When more than one venue
  // connected the same Calendly account, each has its own subscription and
  // signing key, so the signature says which one this delivery is for (this
  // used to drop the booking for all of them).
  const { data: matches } = await supabaseAdmin
    .from('venues')
    .select('id, calendly_webhook_signing_key')
    .eq('calendly_org_uri', orgUri)
    .eq('calendly_connected', true);
  const candidates = (matches ?? []) as Array<{ id: string; calendly_webhook_signing_key: string | null }>;
  const venue = candidates.length <= 1
    ? candidates[0]
    : candidates.find((c) => c.calendly_webhook_signing_key
        && verifyCalendlySignature(rawBody, request.headers.get('calendly-webhook-signature'), c.calendly_webhook_signing_key).valid);
  if (!venue) {
    if (candidates.length > 1) console.warn(`[calendly webhook] ${candidates.length} venues share ${orgUri} and none matches this signature`);
    return NextResponse.json({ received: true });
  }
  const venueId = venue.id;

  const signingKey = venue.calendly_webhook_signing_key as string | null;
  if (signingKey) {
    const result = verifyCalendlySignature(
      rawBody,
      request.headers.get('calendly-webhook-signature'),
      signingKey
    );
    if (!result.valid) {
      console.warn(`[calendly webhook] signature check failed for venue ${venueId}: ${result.reason}`);
      if (ENFORCE_SIGNATURE) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
      }
    }
  } else {
    console.warn(`[calendly webhook] venue ${venueId} has no signing key on file — accepting unverified (pending resubscribe backfill)`);
  }

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

          // Feature 1: Lead matching + pipeline stage move
          const [matchingLead] = await sql`
            SELECT l.id AS lead_id, l.stage_id, l.pipeline_id, l.ai_state
            FROM leads l
            JOIN lead_pipeline_stages lps ON lps.id = l.stage_id
            WHERE l.venue_id = ${venueId}
              AND lower(l.email) = lower(${inviteeEmail})
              AND lps.kind NOT IN ('won', 'lost')
            ORDER BY l.updated_at DESC
            LIMIT 1
          `;

          // Someone new (no lead with this email at all): the booking is a lead.
          // In Booked Tours, with no follow-ups (they've booked) and no texting
          // consent assumed. Owner's call, Oct 2: every lead goes on to the
          // venue's connected systems and gets the one new-lead email.
          if (!matchingLead) {
            const [anyLead] = await sql`
              SELECT id FROM leads WHERE venue_id = ${venueId} AND lower(email) = lower(${inviteeEmail}) LIMIT 1
            `;
            if (!anyLead) {
              await createLeadFromCalendlyBooking({
                venueId, email: inviteeEmail.toLowerCase(), firstName, lastName,
                eventName: eventName ?? 'Booking', startTime,
              }).catch((e) => console.error('[calendly webhook] lead create failed:', e));
            }
          }

          if (matchingLead) {
            // Find the "Booked Tours" stage in this venue's default pipeline
            const [bookedToursStage] = await sql`
              SELECT lps.id
              FROM lead_pipeline_stages lps
              JOIN lead_pipelines lp ON lp.id = lps.pipeline_id
              WHERE lp.venue_id = ${venueId}
                AND lp.is_default = true
                AND (
                  lps.name ILIKE '%booked%tour%'
                  OR lps.name ILIKE '%tour%booked%'
                )
              LIMIT 1
            `;

            if (bookedToursStage) {
              await sql`
                UPDATE leads
                SET stage_id = ${bookedToursStage.id}, updated_at = now()
                WHERE id = ${matchingLead.lead_id} AND venue_id = ${venueId}
              `;

              await sql`
                INSERT INTO lead_activity_log (venue_id, lead_id, actor_member_id, actor_is_owner, action, details)
                VALUES (
                  ${venueId}, ${matchingLead.lead_id}, NULL, false,
                  'stage_changed',
                  ${JSON.stringify({ notes: 'Stage moved to Booked Tours — tour booked via Calendly', via: 'calendly_webhook' })}::jsonb
                )
              `;
            }

            // Feature 2: Pause AI sequence if not already in a terminal state
            const terminalStates = ['opted_out', 'paused', 'exhausted', 'handoff'];
            if (!terminalStates.includes(matchingLead.ai_state as string)) {
              await sql`
                UPDATE leads
                SET ai_state = 'paused', ai_next_send_at = NULL, updated_at = now()
                WHERE id = ${matchingLead.lead_id} AND venue_id = ${venueId}
              `;

              await sql`
                INSERT INTO lead_activity_log (venue_id, lead_id, actor_member_id, actor_is_owner, action, details)
                VALUES (
                  ${venueId}, ${matchingLead.lead_id}, NULL, false,
                  'ai_paused',
                  ${JSON.stringify({ notes: 'AI follow-up paused — tour booked via Calendly', via: 'calendly_webhook' })}::jsonb
                )
              `;
            }
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

/** A Calendly booking from someone who isn't a lead yet becomes one (see above). */
async function createLeadFromCalendlyBooking(b: {
  venueId: string; email: string; firstName: string; lastName: string; eventName: string; startTime: string;
}): Promise<void> {
  const pipelineId = await ensureDefaultPipeline(b.venueId);
  const { data: stages } = await supabaseAdmin
    .from('lead_pipeline_stages')
    .select('id, name, position')
    .eq('venue_id', b.venueId)
    .eq('pipeline_id', pipelineId)
    .order('position', { ascending: true });
  const list = (stages ?? []) as Array<{ id: string; name: string }>;
  const stage = list.find((s) => /booked.*tour|tour.*booked/i.test(s.name)) ?? list[0] ?? null;
  const name = [b.firstName, b.lastName].filter(Boolean).join(' ').trim() || b.email;
  const now = new Date().toISOString();
  const { data: lead, error } = await supabaseAdmin
    .from('leads')
    .insert({
      venue_id: b.venueId,
      name,
      first_name: b.firstName || null,
      last_name: b.lastName || null,
      email: b.email,
      source: 'calendly',
      status: stage && /tour/i.test(stage.name) ? 'tour_booked' : 'new',
      sms_consent: false,
      ai_state: 'paused',
      pipeline_id: pipelineId,
      stage_id: stage?.id ?? null,
      position: 0,
      updated_at: now,
    })
    .select('id, created_at')
    .single();
  if (error || !lead) throw new Error(error?.message ?? 'no lead');
  const booked = `${b.eventName} on ${new Date(b.startTime).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' })}`;
  notifyOwnerNewLead({
    venueId: b.venueId,
    leadId: lead.id as string,
    fullName: name,
    email: b.email,
    source: 'calendly',
    createdAt: lead.created_at as string,
    details: [{ label: 'Booked', value: booked }],
  });
  handOffNewLead(b.venueId, {
    id: lead.id as string,
    first_name: b.firstName || null,
    last_name: b.lastName || null,
    email: b.email,
    phone: null,
    source: 'calendly',
    created_at: lead.created_at as string,
    message: `Booked via Calendly: ${booked}`,
  });
}
