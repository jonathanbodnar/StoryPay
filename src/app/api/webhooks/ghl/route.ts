import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  describeGhlInboundWebhookShape,
  insertInboundGhlSms,
  isGhlInboundMessageWebhookPayload,
  parseGhlInboundSmsPayload,
} from '@/lib/ghl-sms-conversations';
import { applySmsDndForVenueCustomer, applySmsOptInForVenueCustomer, isSmsOptOutKeyword, isSmsOptInKeyword } from '@/lib/sms-compliance';
import { syncSingleGhlContact } from '@/lib/ghl-contacts-sync';
import { ghlDndToConversationFlags } from '@/app/api/venue-customers/[id]/dnd/route';
import { handleInboundAiMessage } from '@/lib/ai-concierge/inbound-handler';

export async function POST(request: NextRequest) {
  try {
    const raw = await request.text();
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
        } else {
          // TCPA keyword routing — runs FIRST so the AI inbound handler sees
          // the correct dnd state. Both STOP and START sync bidirectionally
          // with GHL so the venue/concierge team only ever has to manage the
          // contact in the SaaS (DND boxes mirror automatically).
          if (r.venueCustomerId) {
            if (isSmsOptOutKeyword(inboundSms.body)) {
              await applySmsDndForVenueCustomer({
                venueId: venue.id as string,
                venueCustomerId: r.venueCustomerId,
                source: 'inbound_stop_keyword',
              });
            } else if (isSmsOptInKeyword(inboundSms.body)) {
              await applySmsOptInForVenueCustomer({
                venueId: venue.id as string,
                venueCustomerId: r.venueCustomerId,
                source: 'inbound_start_keyword',
              });
            }
          }

          // AI Concierge: classify the reply + drive the lead's AI state machine.
          // Only runs when the message was newly inserted (not a duplicate
          // re-delivery from GHL) AND we resolved a venue_customer.
          if (r.inserted && r.venueCustomerId) {
            void handleInboundAiMessage({
              venueId:         venue.id as string,
              venueCustomerId: r.venueCustomerId,
              messageBody:     inboundSms.body,
              ghlMessageId:    inboundSms.messageId ?? null,
            }).catch((err) => {
              console.error('[ghl webhook] AI inbound handler failed:', err);
            });
          }
        }
      } else {
        console.warn('[ghl webhook] inbound SMS: no venue for locationId', inboundSms.locationId);
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
              const smsDnd = (dndSettings as { SMS?: { status?: string } } | undefined)?.SMS?.status === 'active';

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
