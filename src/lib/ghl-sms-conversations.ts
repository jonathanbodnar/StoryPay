import { createHash } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import {
  getGhlContact,
  getGhlToken,
  listGhlConversationIdsForContactOrdered,
  listGhlConversationMessages,
  normalizePhone,
} from '@/lib/ghl';

const PLACEHOLDER_EMAIL_DOMAIN = 'ghl-sms.storypay.placeholder';

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function pickStr(obj: Record<string, unknown>, keys: string[]): string {
  if (!obj || typeof obj !== 'object') return '';
  for (const key of keys) {
    const lower = key.toLowerCase();
    for (const [k, v] of Object.entries(obj)) {
      if (k.toLowerCase() !== lower) continue;
      if (v == null) continue;
      const s = String(v).trim();
      if (s) return s;
    }
  }
  return '';
}

function htmlToPlain(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function inboundMessageEventMatch(value: unknown): boolean {
  const s = String(value ?? '')
    .toLowerCase()
    .replace(/[\s_\-]+/g, '');
  return s === 'inboundmessage';
}

function eventNameCandidates(payload: Record<string, unknown>, dataObj: Record<string, unknown> | null) {
  return [
    payload.type,
    payload.event,
    payload.name,
    payload.eventName,
    payload.webhookEvent,
    dataObj?.type,
    dataObj?.event,
    dataObj?.name,
  ];
}

/** True if this webhook is a GHL / LeadConnector InboundMessage (type may be on a wrapper or nested data). */
export function isGhlInboundMessageWebhookPayload(payload: Record<string, unknown>): boolean {
  const dataObj = parseJsonObject(payload.data);
  if (eventNameCandidates(payload, dataObj).some(inboundMessageEventMatch)) return true;

  const pl = parseJsonObject(payload.payload);
  if (pl && [pl.type, pl.event, pl.name].some(inboundMessageEventMatch)) return true;

  if (Array.isArray(payload.data)) {
    for (const item of payload.data) {
      const o = parseJsonObject(item);
      if (o && [o.type, o.event, o.name].some(inboundMessageEventMatch)) return true;
    }
  }
  return false;
}

function isGhlSmsChannel(root: Record<string, unknown>): boolean {
  const mt = pickStr(root, ['messageType', 'channel']).toUpperCase();
  if (mt === 'SMS' || mt === 'TEXT') return true;
  const mts = pickStr(root, ['messageTypeString', 'message_type_string']).toUpperCase();
  if (mts === 'TYPE_SMS' || mts.includes('SMS')) return true;
  const id = root.messageTypeId ?? root.message_type_id;
  if (id === 2 || id === '2') return true;
  const mtRaw = root.messageType;
  if (mtRaw === 2 || mtRaw === '2') return true;
  return false;
}

/** Merge strategies for marketplace vs flat InboundMessage payloads. */
function inboundSmsRootCandidates(payload: Record<string, unknown>): Record<string, unknown>[] {
  const list: Record<string, unknown>[] = [];
  const push = (r: Record<string, unknown>) => list.push(r);

  push({ ...payload });
  const dataObj = parseJsonObject(payload.data);
  if (dataObj) {
    push({ ...payload, ...dataObj });
    for (const nestKey of ['message', 'record', 'meta', 'attributes']) {
      const nest = parseJsonObject(dataObj[nestKey]);
      if (nest) push({ ...payload, ...dataObj, ...nest });
    }
  }
  if (Array.isArray(payload.data)) {
    for (const item of payload.data) {
      const o = parseJsonObject(item);
      if (o) push({ ...payload, ...o });
    }
  }
  const pl = parseJsonObject(payload.payload);
  if (pl) push({ ...payload, ...pl });

  return list;
}

/** One-line diagnostic when InboundMessage does not parse (no PII: no body text). */
export function describeGhlInboundWebhookShape(payload: Record<string, unknown>): string {
  const dataObj = parseJsonObject(payload.data);
  const dataKeys =
    dataObj && typeof dataObj === 'object' ? Object.keys(dataObj).slice(0, 24).join(',') : '';
  const arr = Array.isArray(payload.data) ? `data[len=${payload.data.length}]` : '';
  const locHint = pickStr(
    { ...(dataObj || {}), ...payload },
    ['locationId', 'location_id']
  );
  const locPresent = locHint ? 'loc=yes' : 'loc=no';
  const chHint = pickStr(
    { ...(dataObj || {}), ...payload },
    ['messageType', 'messageTypeString', 'channel']
  );
  return JSON.stringify({
    topKeys: Object.keys(payload).slice(0, 20),
    dataKeys: dataKeys || arr,
    type: payload.type,
    event: payload.event,
    name: payload.name,
    locPresent,
    channelHint: chHint ? String(chHint).slice(0, 24) : '',
  });
}

/** Normalize GHL InboundMessage webhook payloads (shape varies by app version). */
export function parseGhlInboundSmsPayload(payload: Record<string, unknown>): {
  locationId: string;
  contactId: string;
  body: string;
  messageId: string | null;
  contactName: string | null;
} | null {
  if (!isGhlInboundMessageWebhookPayload(payload)) return null;

  for (const root of inboundSmsRootCandidates(payload)) {
    if (!isGhlSmsChannel(root)) continue;

    const direction = pickStr(root, ['direction']).toLowerCase();
    if (direction === 'outbound') continue;

    const locationId = pickStr(root, [
      'locationId',
      'location_id',
      'subAccountId',
      'sub_account_id',
    ]);
    let contactId = pickStr(root, ['contactId', 'contact_id']);
    if (!contactId) {
      const c = parseJsonObject(root.contact);
      if (c) contactId = pickStr(c, ['id', 'contactId', 'contact_id']);
    }
    let body = pickStr(root, ['body', 'messageBody', 'message', 'text', 'content']);
    if (!body) {
      const html = pickStr(root, ['html', 'bodyHtml', 'body_html']);
      if (html) body = htmlToPlain(html);
    }
    let messageId = pickStr(root, ['messageId', 'msgId']) || null;
    if (!messageId) {
      const mid = root.messageId ?? root.id;
      if (mid != null && String(mid).trim()) messageId = String(mid).trim();
    }

    if (!locationId || !contactId || !body) continue;

    let contactName: string | null = null;
    const c = parseJsonObject(root.contact);
    if (c) {
      contactName = [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || null;
    }

    return { locationId, contactId, body, messageId, contactName };
  }
  return null;
}

/**
 * Ensure a venue_customer row exists and is linked to this GHL contact.
 */
export async function upsertVenueCustomerFromGhl(params: {
  venueId: string;
  locationId: string;
  contactId: string;
}): Promise<string | null> {
  const { venueId, locationId, contactId } = params;

  const { data: existing } = await supabaseAdmin
    .from('venue_customers')
    .select('id')
    .eq('venue_id', venueId)
    .eq('ghl_contact_id', contactId)
    .maybeSingle();
  if (existing?.id) return existing.id as string;

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('ghl_access_token')
    .eq('id', venueId)
    .maybeSingle();
  const token = venue ? getGhlToken(venue as { ghl_access_token?: string | null }) : null;
  if (!token) {
    console.error('[ghl-sms] no GHL token for venue', venueId);
    return null;
  }

  let email = '';
  let phone: string | null = null;
  let firstName = '';
  let lastName = '';
  try {
    const raw = await getGhlContact(token, locationId, contactId);
    const c = (raw as { contact?: Record<string, unknown> }).contact || (raw as Record<string, unknown>);
    email = String(c.email ?? '').trim();
    phone = normalizePhone(c.phone != null ? String(c.phone) : null);
    firstName = String(c.firstName ?? '').trim();
    lastName = String(c.lastName ?? '').trim();
  } catch (e) {
    console.error('[ghl-sms] getGhlContact failed', contactId, e);
  }

  if (!email) {
    email = `ghl.${contactId}@${PLACEHOLDER_EMAIL_DOMAIN}`;
  }

  const { data: created, error } = await supabaseAdmin
    .from('venue_customers')
    .insert({
      venue_id: venueId,
      customer_email: email,
      first_name: firstName || 'Contact',
      last_name: lastName,
      phone: phone || null,
      ghl_contact_id: contactId,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      const { data: byEmail } = await supabaseAdmin
        .from('venue_customers')
        .select('id')
        .eq('venue_id', venueId)
        .eq('customer_email', email)
        .maybeSingle();
      if (byEmail?.id) {
        await supabaseAdmin
          .from('venue_customers')
          .update({
            ghl_contact_id: contactId,
            ...(phone ? { phone } : {}),
            ...(firstName ? { first_name: firstName } : {}),
            ...(lastName ? { last_name: lastName } : {}),
          })
          .eq('id', byEmail.id);
        return byEmail.id as string;
      }
    }
    console.error('[ghl-sms] insert venue_customer', error);
    return null;
  }
  return created?.id as string;
}

/** One SMS thread per venue customer (separate from email "Conversation" threads). */
export async function ensureSmsThread(venueId: string, venueCustomerId: string): Promise<string | null> {
  const { data: smsThread } = await supabaseAdmin
    .from('conversation_threads')
    .select('id')
    .eq('venue_id', venueId)
    .eq('venue_customer_id', venueCustomerId)
    .eq('external_reply_channel', 'sms')
    .maybeSingle();
  if (smsThread?.id) return smsThread.id as string;

  const { data: t, error } = await supabaseAdmin
    .from('conversation_threads')
    .insert({
      venue_id: venueId,
      venue_customer_id: venueCustomerId,
      subject: 'SMS',
      external_reply_channel: 'sms',
    })
    .select('id')
    .single();
  if (error) {
    console.error('[ghl-sms] create thread', error);
    return null;
  }
  return t.id as string;
}

export async function insertInboundGhlSms(params: {
  venueId: string;
  locationId: string;
  contactId: string;
  messageBody: string;
  ghlMessageId: string | null;
  contactName?: string | null;
  /** When set, message is stored on this thread if it belongs to the resolved venue customer. */
  threadId?: string;
  createdAt?: string | null;
}): Promise<{ ok: boolean; error?: string; venueCustomerId?: string; inserted?: boolean }> {
  const { venueId, locationId, contactId, messageBody, ghlMessageId, contactName, threadId: preferredThreadId, createdAt } =
    params;
  if (!messageBody?.trim()) return { ok: true, inserted: false };

  if (ghlMessageId) {
    const { data: dup } = await supabaseAdmin
      .from('conversation_messages')
      .select('id')
      .eq('ghl_message_id', ghlMessageId)
      .maybeSingle();
    if (dup) return { ok: true, inserted: false };
  }

  const customerId = await upsertVenueCustomerFromGhl({ venueId, locationId, contactId });
  if (!customerId) return { ok: false, error: 'no_customer' };

  let threadId: string | null = null;
  if (preferredThreadId) {
    // Don't gate on external_reply_channel — a thread can carry both SMS and
    // email messages once the venue has sent both channels in the same
    // conversation. The fact that the venue_customer match holds is proof
    // enough that the inbound message belongs in this thread.
    const { data: trow } = await supabaseAdmin
      .from('conversation_threads')
      .select('id')
      .eq('id', preferredThreadId)
      .eq('venue_id', venueId)
      .eq('venue_customer_id', customerId)
      .maybeSingle();
    if (trow?.id) threadId = trow.id as string;
  }
  if (!threadId) threadId = await ensureSmsThread(venueId, customerId);
  if (!threadId) return { ok: false, error: 'no_thread' };

  const row: Record<string, unknown> = {
    thread_id: threadId,
    visibility: 'external',
    channel: 'sms',
    body: messageBody.trim(),
    sender_kind: 'contact',
    contact_from_name: contactName?.trim() || null,
    contact_from_email: null,
    ghl_message_id: ghlMessageId || null,
  };
  if (createdAt && String(createdAt).trim()) {
    row.created_at = String(createdAt).trim();
  }

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from('conversation_messages')
    .insert(row)
    .select('id, created_at')
    .single();
  if (insErr) {
    if (insErr.code === '23505') return { ok: true, inserted: false };
    console.error('[ghl-sms] insert message', insErr);
    return { ok: false, error: insErr.message };
  }

  // Auto-reopen: if the support team had previously closed this thread but
  // the bride is now replying again, the thread needs to come back into the
  // "Needs Reply" inbox. Best-effort — ignore the error if the status column
  // doesn't exist yet (older DB without migration 115).
  void supabaseAdmin
    .from('conversation_threads')
    .update({ status: 'open' })
    .eq('id', threadId)
    .eq('status', 'closed')
    .then(() => undefined, () => undefined);

  // Realtime broadcast — bride inbox + active thread + venue conversations
  if (inserted) {
    const broadcastInbound = async () => {
      try {
        const { broadcastBrideMessage } = await import('@/lib/realtime/broadcast');
        await broadcastBrideMessage({
          inbound:            true,
          threadId,
          venueId,
          venueCustomerId:    customerId,
          messageId:          (inserted as { id: string }).id,
          body:               messageBody.trim(),
          channel:            'sms',
          senderKind:         'contact',
          sentByVenueSupport: false,
          supportAgentId:     null,
          createdAt:          (inserted as { created_at?: string }).created_at || new Date().toISOString(),
        });
      } catch (e) {
        console.warn('[ghl-sms] broadcast failed', e);
      }
    };
    void broadcastInbound();
  }

  return { ok: true, inserted: true, venueCustomerId: customerId };
}

function ghlApiMessagesFromResponse(raw: unknown): Record<string, unknown>[] {
  if (!raw || typeof raw !== 'object') return [];
  const o = raw as Record<string, unknown>;
  const candidates: unknown[] = [
    o.messages,
    o.messageList,
    o.results,
    o.data,
    o.items,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate as Record<string, unknown>[];
    if (candidate && typeof candidate === 'object') {
      const bag = candidate as Record<string, unknown>;
      for (const key of ['messages', 'data', 'items', 'nodes']) {
        const inner = bag[key];
        if (Array.isArray(inner)) return inner as Record<string, unknown>[];
      }
    }
  }
  return [];
}

function isGhlApiInboundSmsMessage(msg: Record<string, unknown>): boolean {
  const dir = String(msg.direction ?? '').toLowerCase();
  if (dir === 'outbound') return false;

  // GHL's /conversations/{id}/messages endpoint returns SMS as
  //   { type: 2, ... }
  // where `type` is a numeric enum (1=email, 2=sms, 3=call, ...). The same
  // value also appears under `messageType` / `messageTypeId` depending on
  // the API surface, so check all of them and accept both numeric and
  // string forms.
  const numericCandidates = [msg.type, msg.messageType, msg.messageTypeId];
  for (const c of numericCandidates) {
    if (c === 2 || c === '2') return true;
  }

  const typeStr = String(msg.type ?? msg.messageType ?? msg.channel ?? '').toUpperCase();
  if (typeStr === 'SMS' || typeStr === 'TEXT' || typeStr === 'TYPE_SMS') return true;

  const mts = String(msg.messageTypeString ?? '').toUpperCase();
  if (mts.includes('SMS')) return true;

  return false;
}

function bodyFromGhlApiMessage(msg: Record<string, unknown>): string {
  const content = msg.content;
  const fromContent =
    content && typeof content === 'object'
      ? (content as Record<string, unknown>).text ??
        (content as Record<string, unknown>).body ??
        (content as Record<string, unknown>).message
      : undefined;
  const raw =
    fromContent ??
    msg.body ??
    msg.text ??
    msg.message ??
    (typeof msg.content === 'string' ? msg.content : '') ??
    msg.messageBody ??
    '';
  let s = String(raw ?? '').trim();
  if (!s && msg.html) {
    s = String(msg.html)
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return s;
}

function ghlApiMessageId(msg: Record<string, unknown>): string | null {
  const id = msg.id ?? msg.messageId ?? msg._id;
  if (id == null) return null;
  const s = String(id).trim();
  return s || null;
}

function syntheticGhlSyncMessageId(params: {
  conversationId: string;
  body: string;
  createdAt: string | null;
}): string {
  const h = createHash('sha256')
    .update([params.conversationId, params.body, params.createdAt ?? ''].join('\0'))
    .digest('hex')
    .slice(0, 48);
  return `ghl-sync:${h}`;
}

/**
 * Pull inbound SMS from GHL for this thread (covers missing / misconfigured InboundMessage webhooks).
 * Best-effort: errors are logged, never thrown.
 */
export async function syncInboundSmsFromGhlForThread(params: {
  venueId: string;
  threadId: string;
  venueCustomerId: string;
}): Promise<{ imported: number }> {
  const { venueId, threadId, venueCustomerId } = params;

  const logSkip = (reason: string, extra?: Record<string, unknown>) => {
    console.log('[ghl-sms sync] skip', { threadId, reason, ...extra });
    return { imported: 0 } as const;
  };

  try {
    const { data: venue } = await supabaseAdmin
      .from('venues')
      .select('ghl_access_token, ghl_location_id, ghl_connected')
      .eq('id', venueId)
      .maybeSingle();

    if (!(venue as { ghl_connected?: boolean } | null)?.ghl_connected) {
      return logSkip('ghl_not_connected');
    }
    const locationId = (venue as { ghl_location_id?: string | null })?.ghl_location_id;
    if (!locationId) return logSkip('no_location_id');

    const token = getGhlToken(venue as { ghl_access_token?: string | null });
    if (!token) return logSkip('no_ghl_token');

    const { data: vc } = await supabaseAdmin
      .from('venue_customers')
      .select('ghl_contact_id')
      .eq('id', venueCustomerId)
      .eq('venue_id', venueId)
      .maybeSingle();

    const contactId = (vc as { ghl_contact_id?: string | null } | null)?.ghl_contact_id;
    if (!contactId) return logSkip('no_ghl_contact_id', { venueCustomerId });

    let convIds: string[] = [];
    try {
      convIds = await listGhlConversationIdsForContactOrdered(token, locationId, contactId, 25);
    } catch (e) {
      console.error('[ghl-sms sync] list conversations failed', {
        threadId,
        contactId,
        error: e instanceof Error ? e.message : String(e),
      });
      return { imported: 0 };
    }
    if (convIds.length === 0) {
      return logSkip('no_conversations_for_contact', { contactId });
    }

    const maxConv = Math.min(
      8,
      Math.max(1, Number.parseInt(process.env.GHL_SMS_SYNC_MAX_CONVERSATIONS ?? '8', 10) || 8)
    );
    // Always log enough to diagnose "imported: 0" without needing to set a
    // separate env var. Sample-of-one structural dump is OFF by default — flip
    // GHL_SMS_SYNC_DEBUG=1 in Railway when we need to see raw message shape.
    const debug = process.env.GHL_SMS_SYNC_DEBUG === '1';

    console.log('[ghl-sms sync] starting', {
      threadId,
      contactId,
      conversationsFound: convIds.length,
      scanning: convIds.slice(0, maxConv),
    });

    let imported = 0;
    let inboundCandidates = 0;
    let totalMsgs = 0;
    let inboundCount = 0;
    let outboundCount = 0;
    const seenTypes: Record<string, number> = {};
    let firstNonInboundSample: Record<string, unknown> | null = null;
    for (const ghlConversationId of convIds.slice(0, maxConv)) {
      let rawList: unknown;
      try {
        rawList = await listGhlConversationMessages(token, locationId, ghlConversationId);
      } catch (e) {
        console.warn('[ghl-sms sync] list messages failed', {
          ghlConversationId,
          error: e instanceof Error ? e.message : String(e),
        });
        continue;
      }
      const list = ghlApiMessagesFromResponse(rawList);
      console.log('[ghl-sms sync] conv scan', {
        ghlConversationId,
        messageCount: list.length,
        sampleKeys: list[0] ? Object.keys(list[0]).slice(0, 20) : [],
      });
      if (debug && list[0]) {
        console.log('[ghl-sms sync] sample message', JSON.stringify(list[0]).slice(0, 800));
      }
      totalMsgs += list.length;

      for (const msg of list) {
        const dir = String(msg.direction ?? '').toLowerCase();
        const t = String(msg.type ?? msg.messageType ?? msg.channel ?? '').toUpperCase();
        seenTypes[t] = (seenTypes[t] ?? 0) + 1;
        if (dir === 'outbound') {
          outboundCount++;
          continue;
        }
        if (dir === 'inbound') inboundCount++;
        if (!isGhlApiInboundSmsMessage(msg)) {
          // Capture a sample of "things that look inbound-ish but didn't pass
          // the SMS filter" so we can adjust isGhlApiInboundSmsMessage if GHL
          // has stuffed the reply into an unexpected field shape.
          if (!firstNonInboundSample && dir === 'inbound') {
            firstNonInboundSample = msg;
          }
          continue;
        }
        const body = bodyFromGhlApiMessage(msg);
        if (!body) continue;
        inboundCandidates++;
        const createdAt =
          (msg.dateAdded as string | undefined) ||
          (msg.createdAt as string | undefined) ||
          (msg.date as string | undefined) ||
          (msg.sentAt as string | undefined) ||
          null;
        let ghlMessageId = ghlApiMessageId(msg);
        if (!ghlMessageId) {
          ghlMessageId = syntheticGhlSyncMessageId({
            conversationId: ghlConversationId,
            body,
            createdAt,
          });
        }

        const r = await insertInboundGhlSms({
          venueId,
          locationId,
          contactId,
          messageBody: body,
          ghlMessageId,
          threadId,
          createdAt,
        });
        if (r.inserted) imported++;
        else if (!r.ok) {
          console.warn('[ghl-sms sync] insert skipped', {
            ghlConversationId,
            error: r.error,
          });
        }
      }
    }

    console.log('[ghl-sms sync] done', {
      threadId,
      contactId,
      conversationsScanned: Math.min(convIds.length, maxConv),
      totalMsgs,
      inboundCount,
      outboundCount,
      seenTypes,
      inboundCandidates,
      imported,
    });
    if (firstNonInboundSample) {
      console.warn('[ghl-sms sync] inbound msg found but FAILED SMS filter:', {
        keys: Object.keys(firstNonInboundSample).slice(0, 30),
        direction: firstNonInboundSample.direction,
        type: firstNonInboundSample.type,
        messageType: firstNonInboundSample.messageType,
        channel: firstNonInboundSample.channel,
        messageTypeId: firstNonInboundSample.messageTypeId,
        messageTypeString: firstNonInboundSample.messageTypeString,
        sample: JSON.stringify(firstNonInboundSample).slice(0, 500),
      });
    }
    return { imported };
  } catch (e) {
    console.error('[ghl-sms] syncInboundSmsFromGhlForThread', e);
    return { imported: 0 };
  }
}
