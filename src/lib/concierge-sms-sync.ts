/**
 * Polls GHL for inbound SMS replies to concierge-initiated direct messages
 * to a venue owner or team member — sent from Support Inbox → Private
 * Clients, or from the venue contact card on a bride/lead thread
 * (src/app/api/admin/support/private-clients/message/route.ts).
 *
 * Those sends create/reuse a GHL contact for the recipient (cached on
 * venues.owner_concierge_ghl_contact_id or
 * venue_team_members.concierge_ghl_contact_id) but never ride the
 * bride/lead conversation_threads model, so nothing else in the app was
 * watching for a reply — an owner/team text-back would land in GHL and
 * never resurface in StoryVenue. This closes that gap by reusing the same
 * GHL conversation/message helpers as the bride-thread SMS sync
 * (src/lib/ghl-sms-conversations.ts) and recording inbound replies as
 * `direction: 'inbound'` rows in private_client_messages.
 *
 * Runs inside the in-app scheduler (src/lib/in-app-scheduler.ts). The
 * contact set here is small — only people the concierge team has actually
 * texted — so a light ~20s cadence is enough; it doesn't need the bride
 * hot-tier's every-7s bar, and stays well clear of the GHL rate limits that
 * prompted the ghlRequest 429-retry fix.
 */
import { supabaseAdmin } from '@/lib/supabase';
import { getGhlToken, listGhlConversationIdsForContactOrdered, listGhlConversationMessages } from '@/lib/ghl';
import {
  ghlApiMessagesFromResponse,
  isGhlApiInboundSmsMessage,
  bodyFromGhlApiMessage,
  ghlApiMessageId,
} from '@/lib/ghl-sms-conversations';

interface ConciergeContact {
  venueId: string;
  venueName: string;
  locationId: string;
  token: string;
  recipientType: 'owner' | 'team_member';
  recipientTeamMemberId: string | null;
  recipientLabel: string;
  ghlContactId: string;
}

interface VenueRow {
  id: string;
  name: string | null;
  ghl_access_token: string | null;
  ghl_location_id: string | null;
  ghl_connected: boolean | null;
  owner_concierge_ghl_contact_id: string | null;
}

interface TeamMemberRow {
  id: string;
  venue_id: string;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  concierge_ghl_contact_id: string | null;
}

async function loadConciergeContacts(): Promise<ConciergeContact[]> {
  const contacts: ConciergeContact[] = [];

  const { data: venueRows } = await supabaseAdmin
    .from('venues')
    .select('id, name, ghl_access_token, ghl_location_id, ghl_connected, owner_concierge_ghl_contact_id')
    .eq('ghl_connected', true)
    .not('owner_concierge_ghl_contact_id', 'is', null);

  const venueById = new Map<string, VenueRow>();
  for (const v of (venueRows ?? []) as VenueRow[]) {
    venueById.set(v.id, v);
    const token = getGhlToken(v);
    if (!token || !v.ghl_location_id || !v.owner_concierge_ghl_contact_id) continue;
    contacts.push({
      venueId: v.id,
      venueName: v.name || 'Unknown venue',
      locationId: v.ghl_location_id,
      token,
      recipientType: 'owner',
      recipientTeamMemberId: null,
      recipientLabel: 'Account owner',
      ghlContactId: v.owner_concierge_ghl_contact_id,
    });
  }

  const { data: teamRows } = await supabaseAdmin
    .from('venue_team_members')
    .select('id, venue_id, name, first_name, last_name, concierge_ghl_contact_id')
    .not('concierge_ghl_contact_id', 'is', null);

  const missingVenueIds = Array.from(
    new Set(((teamRows ?? []) as TeamMemberRow[]).map((t) => t.venue_id).filter((id) => !venueById.has(id))),
  );
  if (missingVenueIds.length > 0) {
    const { data: extraVenues } = await supabaseAdmin
      .from('venues')
      .select('id, name, ghl_access_token, ghl_location_id, ghl_connected, owner_concierge_ghl_contact_id')
      .in('id', missingVenueIds)
      .eq('ghl_connected', true);
    for (const v of (extraVenues ?? []) as VenueRow[]) venueById.set(v.id, v);
  }

  for (const t of (teamRows ?? []) as TeamMemberRow[]) {
    const v = venueById.get(t.venue_id);
    if (!v || !t.concierge_ghl_contact_id) continue;
    const token = getGhlToken(v);
    if (!token || !v.ghl_location_id) continue;
    const label = t.name?.trim() || [t.first_name, t.last_name].filter(Boolean).join(' ').trim() || 'Team member';
    contacts.push({
      venueId: t.venue_id,
      venueName: v.name || 'Unknown venue',
      locationId: v.ghl_location_id,
      token,
      recipientType: 'team_member',
      recipientTeamMemberId: t.id,
      recipientLabel: label,
      ghlContactId: t.concierge_ghl_contact_id,
    });
  }

  return contacts;
}

export interface ConciergeSmsReplySyncResult {
  contactsChecked: number;
  messagesImported: number;
}

/** Best-effort: never throws — a stalled sync tick shouldn't crash the scheduler. */
export async function runConciergeSmsReplySync(): Promise<ConciergeSmsReplySyncResult> {
  const result: ConciergeSmsReplySyncResult = { contactsChecked: 0, messagesImported: 0 };

  let contacts: ConciergeContact[] = [];
  try {
    contacts = await loadConciergeContacts();
  } catch (e) {
    console.warn('[concierge-sms-sync] load contacts failed', e);
    return result;
  }
  if (contacts.length === 0) return result;

  for (const c of contacts) {
    result.contactsChecked++;
    try {
      const convIds = await listGhlConversationIdsForContactOrdered(c.token, c.locationId, c.ghlContactId, 10);
      for (const convId of convIds.slice(0, 5)) {
        let rawList: unknown;
        try {
          rawList = await listGhlConversationMessages(c.token, c.locationId, convId);
        } catch (e) {
          console.warn('[concierge-sms-sync] list messages failed', { convId, error: e instanceof Error ? e.message : String(e) });
          continue;
        }
        const list = ghlApiMessagesFromResponse(rawList);
        for (const msg of list) {
          const dir = String(msg.direction ?? '').toLowerCase();
          if (dir !== 'inbound') continue;
          if (!isGhlApiInboundSmsMessage(msg)) continue;
          const body = bodyFromGhlApiMessage(msg);
          if (!body) continue;
          const ghlMessageId = ghlApiMessageId(msg) || `concierge-sync:${convId}:${body.slice(0, 64)}`;

          const { data: dup } = await supabaseAdmin
            .from('private_client_messages')
            .select('id')
            .eq('ghl_message_id', ghlMessageId)
            .maybeSingle();
          if (dup) continue;

          const createdAt =
            (msg.dateAdded as string | undefined) ||
            (msg.createdAt as string | undefined) ||
            (msg.date as string | undefined) ||
            null;

          const { data: inserted, error } = await supabaseAdmin
            .from('private_client_messages')
            .insert({
              venue_id: c.venueId,
              recipient_type: c.recipientType,
              recipient_team_member_id: c.recipientTeamMemberId,
              recipient_label: c.recipientLabel,
              recipient_email: null,
              recipient_phone: null,
              channel: 'sms',
              body,
              direction: 'inbound',
              ghl_message_id: ghlMessageId,
              ghl_contact_id: c.ghlContactId,
              external_sent: true,
              sent_by_support_user_id: null,
              ...(createdAt ? { created_at: createdAt } : {}),
            })
            .select('id')
            .single();

          if (error) {
            if (error.code !== '23505') console.warn('[concierge-sms-sync] insert failed', error.message);
            continue;
          }
          if (!inserted) continue;

          result.messagesImported++;

          void (async () => {
            try {
              const { broadcastPrivateClientMessage } = await import('@/lib/realtime/broadcast');
              await broadcastPrivateClientMessage({ venueId: c.venueId, direction: 'inbound', channel: 'sms' });
            } catch (e) {
              console.warn('[concierge-sms-sync] broadcast failed', e);
            }
          })();

          void (async () => {
            try {
              const { notifyPrivateClientReply } = await import('@/lib/slack-notify');
              await notifyPrivateClientReply({
                venueName: c.venueName,
                recipientLabel: c.recipientLabel,
                messagePreview: body,
                venueId: c.venueId,
              });
            } catch (e) {
              console.warn('[concierge-sms-sync] slack notify failed', e);
            }
          })();
        }
      }
    } catch (e) {
      console.warn('[concierge-sms-sync] contact sync failed', {
        venueId: c.venueId,
        recipientLabel: c.recipientLabel,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return result;
}
