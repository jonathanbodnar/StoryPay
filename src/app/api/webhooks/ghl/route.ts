import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  describeGhlInboundWebhookShape,
  insertInboundGhlSms,
  isGhlInboundMessageWebhookPayload,
  parseGhlInboundSmsPayload,
} from '@/lib/ghl-sms-conversations';
import { syncSingleGhlContact } from '@/lib/ghl-contacts-sync';
import { isGhlDndOn } from '@/lib/ghl';
import { ghlDndToConversationFlags } from '@/app/api/venue-customers/[id]/dnd/route';
import { runInboundGhlSmsSideEffects } from '@/lib/ghl-inbound-sms-side-effects';
import { verifyGhlWebhookSignature } from '@/lib/ghl-webhook-verify';
import { logError } from '@/lib/error-log';

// Rollout switch for GHL webhook signature enforcement. Starts OFF
// (monitor-only: every request is verified and logged, but nothing is
// rejected) so we can confirm real GHL traffic actually carries a valid
// X-GHL-Signature/X-WH-Signature header before we start dropping requests.
// Flip GHL_WEBHOOK_ENFORCE_SIGNATURE=true once the logs below show
// "signature valid" on real incoming traffic for a few days with zero
// "missing"/"invalid" entries.
const ENFORCE_GHL_SIGNATURE = process.env.GHL_WEBHOOK_ENFORCE_SIGNATURE === 'true';

export async function POST(request: NextRequest) {
  try {
    const raw = await request.text();

    const verification = verifyGhlWebhookSignature(raw, request.headers);
    if (verification.status !== 'valid') {
      const detail =
        verification.status === 'invalid'
          ? `invalid (${verification.header}: ${verification.reason})`
          : 'missing (no x-ghl-signature or x-wh-signature header)';
      console.warn(
        `[ghl webhook] signature ${detail} — ${ENFORCE_GHL_SIGNATURE ? 'REJECTING' : 'monitor-only, still processing'}`
      );
      if (ENFORCE_GHL_SIGNATURE) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
      }
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      console.error('[ghl webhook] invalid JSON body, len=', raw.length);
      return NextResponse.json({ received: true });
    }

    const eventType = payload.type || payload.event;

    console.log('GHL webhook received:', eventType, JSON.stringify(payload).slice(0, 500));

    const inboundSms = parseGhlInboundSmsPayload(payload);
    if (isGhlInboundMessageWebhookPayload(payload) && !inboundSms) {
      console.warn(
        '[ghl webhook] InboundMessage received but SMS not ingested — shape:',
        describeGhlInboundWebhookShape(payload)
      );
    }
    if (inboundSms) {
      const { data: venue } = await supabaseAdmin
        .from('venues')
        .select('id')
        .eq('ghl_location_id', inboundSms.locationId)
        .maybeSingle();
      if (venue?.id) {
        const r = await insertInboundGhlSms({
          venueId: venue.id as string,
          locationId: inboundSms.locationId,
          contactId: inboundSms.contactId,
          messageBody: inboundSms.body,
          ghlMessageId: inboundSms.messageId,
          contactName: inboundSms.contactName,
        });
        if (!r.ok) {
          console.error('[ghl webhook] inbound SMS ingest failed:', r.error);
          void logError({
            level: 'error',
            source: 'webhook',
            category: 'ghl_inbound_sms_ingest_failed',
            message: `GHL inbound SMS could not be stored for venue ${venue.id} (locationId ${inboundSms.locationId}): ${r.error}. The customer's reply was received by GHL but never reached a conversation thread.`,
            venueId: venue.id as string,
            route: '/api/webhooks/ghl',
            context: { locationId: inboundSms.locationId, contactId: inboundSms.contactId, error: r.error },
          });
        } else if (r.venueCustomerId) {
          // TCPA keywords, SMS reply attribution, AI Concierge — shared with
          // the per-location workflow webhook (/api/webhooks/ghl-workflow-inbound)
          // so the two inbound paths can't drift.
          await runInboundGhlSmsSideEffects({
            venueId:         venue.id as string,
            venueCustomerId: r.venueCustomerId,
            messageBody:     inboundSms.body,
            ghlMessageId:    inboundSms.messageId ?? null,
            inserted:        r.inserted === true,
            logPrefix:       '[ghl webhook]',
          });
        }
      } else {
        console.warn('[ghl webhook] inbound SMS: no venue for locationId', inboundSms.locationId);
        void logError({
          level: 'warning',
          source: 'webhook',
          category: 'ghl_inbound_no_venue_match',
          message: `GHL sent an inbound SMS webhook for locationId ${inboundSms.locationId}, but no venue in our DB has that ghl_location_id. The message was silently dropped instead of reaching any thread.`,
          route: '/api/webhooks/ghl',
          context: { locationId: inboundSms.locationId, contactId: inboundSms.contactId },
        });
      }
    }

    switch (eventType) {
      case 'InboundMessage':
      case 'OutboundMessage':
        break;

      case 'ContactCreate':
      case 'ContactUpdate': {
        const data = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
          ? (payload.data as Record<string, unknown>)
          : null;
        const locationId = (payload.locationId ?? data?.locationId) as string | undefined;
        const contactId  = (payload.contactId  ?? data?.id ?? data?.contactId) as string | undefined;
        if (locationId && contactId) {
          // Fire-and-forget — webhook responses must be quick; sync runs async.
          void syncSingleGhlContact(locationId, contactId).catch((err) => {
            console.error('[ghl webhook] ContactCreate/Update sync failed:', err);
          });
        }
        break;
      }

      case 'ContactDndUpdate': {
        // GHL fires this whenever a contact's DND field changes.
        // Payload shape: { type, locationId, id/contactId, dnd, dndSettings, inboundDndSettings }
        const data = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
          ? (payload.data as Record<string, unknown>)
          : payload;
        const locationId = (payload.locationId ?? (data as Record<string, unknown>)?.locationId) as string | undefined;
        const contactId  = (payload.contactId ?? payload.id ?? (data as Record<string, unknown>)?.id ?? (data as Record<string, unknown>)?.contactId) as string | undefined;
        const dndSettings = (payload.dndSettings ?? (data as Record<string, unknown>)?.dndSettings) as Record<string, unknown> | undefined;
        const inboundDndSettings = (payload.inboundDndSettings ?? (data as Record<string, unknown>)?.inboundDndSettings) as Record<string, unknown> | undefined;

        if (locationId && contactId) {
          void (async () => {
            try {
              // Find the venue by locationId
              const { data: venue } = await supabaseAdmin
                .from('venues')
                .select('id')
                .eq('ghl_location_id', locationId)
                .maybeSingle();
              if (!venue?.id) return;

              // Find the venue_customer by ghl_contact_id
              const { data: vc } = await supabaseAdmin
                .from('venue_customers')
                .select('id, sms_dnd, customer_email')
                .eq('venue_id', venue.id)
                .eq('ghl_contact_id', contactId)
                .maybeSingle();
              if (!vc?.id) return;

              const nowIso = new Date().toISOString();
              const smsDnd = isGhlDndOn((dndSettings as { SMS?: { status?: string } } | undefined)?.SMS?.status);

              const update: Record<string, unknown> = {
                updated_at: nowIso,
                ghl_synced_at: nowIso,
              };
              if (dndSettings) update.ghl_dnd_settings = dndSettings;
              if (inboundDndSettings) update.ghl_inbound_dnd_settings = inboundDndSettings;
              // Bridge GHL DND → flat boolean enforcement columns
              if (dndSettings || inboundDndSettings) {
                const flags = ghlDndToConversationFlags(
                  dndSettings as Parameters<typeof ghlDndToConversationFlags>[0],
                  inboundDndSettings as Parameters<typeof ghlDndToConversationFlags>[1],
                );
                update.conversation_dnd_email = flags.conversation_dnd_email;
                update.conversation_dnd_calls = flags.conversation_dnd_calls;
                update.conversation_dnd_inbound_sms = flags.conversation_dnd_inbound_sms;
                update.conversation_dnd_all = flags.conversation_dnd_all;

                if (flags.sms_dnd) {
                  // GHL is blocking SMS → mirror it to our flag
                  if (!vc.sms_dnd) {
                    update.sms_dnd = true;
                    update.sms_dnd_at = nowIso;
                    update.sms_dnd_source = 'ghl_webhook';
                  }
                } else {
                  // GHL cleared the SMS block (e.g. contact texted START) → sync
                  // the opt-in back into our DB so automated messages can resume.
                  // We intentionally clear even TCPA opt-outs here because the
                  // only way GHL clears SMS DND is when the contact explicitly
                  // re-subscribes (START keyword or manual override) — that IS
                  // the required re-consent under TCPA.
                  if (vc.sms_dnd) {
                    update.sms_dnd = false;
                    update.sms_dnd_at = null;
                    update.sms_dnd_source = 'ghl_start_resubscribe';
                  }
                }
              }

              await supabaseAdmin
                .from('venue_customers')
                .update(update)
                .eq('id', vc.id);

              // If SMS DND was just cleared (START re-subscribe), also fix any leads
              // whose ai_state is 'opted_out' due to the STOP — move them to 'paused'
              // so the venue team can re-enable AI without being blocked by TCPA lock.
              // Leads are linked by email since they don't have ghl_contact_id.
              if (update.sms_dnd === false && vc.customer_email) {
                const { data: optedOutLeads } = await supabaseAdmin
                  .from('leads')
                  .select('id')
                  .eq('venue_id', venue.id)
                  .ilike('email', vc.customer_email)
                  .eq('ai_state', 'opted_out');
                if (optedOutLeads && optedOutLeads.length > 0) {
                  await supabaseAdmin
                    .from('leads')
                    .update({
                      sms_dnd: false,
                      sms_dnd_at: null,
                      sms_dnd_source: 'ghl_start_resubscribe',
                      ai_state: 'paused',
                      updated_at: nowIso,
                    })
                    .in('id', optedOutLeads.map((l) => l.id));
                  console.log(`[ghl webhook] Cleared TCPA lock + moved ${optedOutLeads.length} lead(s) to paused after START re-subscribe`);
                }
              }

              console.log('[ghl webhook] ContactDndUpdate synced for contact', contactId);
            } catch (err) {
              console.error('[ghl webhook] ContactDndUpdate sync failed:', err);
            }
          })();
        }
        break;
      }

      case 'AppInstall': {
        const data = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
          ? (payload.data as Record<string, unknown>)
          : null;
        const locationId = (payload.locationId ?? data?.locationId) as string | undefined;
        const access_token = (payload.access_token ?? data?.access_token) as string | undefined;
        const refresh_token = (payload.refresh_token ?? data?.refresh_token) as string | undefined;
        if (locationId && access_token) {
          await supabaseAdmin
            .from('venues')
            .update({
              ghl_access_token: access_token,
              ghl_refresh_token: refresh_token ?? null,
              ghl_location_id: locationId,
              ghl_location_token: access_token,
              ghl_connected: true,
              // A2P lives on the GHL sub-account — installed = SMS compliant.
              a2p_verified: true,
            })
            .eq('ghl_location_id', locationId);
        }
        break;
      }

      case 'AppUninstall': {
        const data = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
          ? (payload.data as Record<string, unknown>)
          : null;
        const uninstallLocId = (payload.locationId ?? data?.locationId) as string | undefined;
        if (uninstallLocId) {
          await supabaseAdmin
            .from('venues')
            .update({
              ghl_connected: false,
              ghl_access_token: null,
              ghl_refresh_token: null,
              ghl_location_token: null,
              // No GHL sub-account = no A2P send path. AI master toggle also
              // goes off so nothing keeps trying to send SMS.
              a2p_verified: false,
              ai_concierge_enabled: false,
            })
            .eq('ghl_location_id', uninstallLocId);
        }
        break;
      }

      default:
        console.log('Unhandled GHL webhook event:', eventType);
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('GHL webhook error:', err);
    return NextResponse.json({ received: true });
  }
}

export async function GET() {
  return NextResponse.json({ status: 'ok' });
}
