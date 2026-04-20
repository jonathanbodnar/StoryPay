import { supabaseAdmin } from '@/lib/supabase';
import { getGhlContact, getGhlToken, normalizePhone } from '@/lib/ghl';

const PLACEHOLDER_EMAIL_DOMAIN = 'ghl-sms.storypay.placeholder';

/** Normalize GHL InboundMessage webhook payloads (shape varies by app version). */
export function parseGhlInboundSmsPayload(payload: Record<string, unknown>): {
  locationId: string;
  contactId: string;
  body: string;
  messageId: string | null;
  contactName: string | null;
} | null {
  const eventType = String(payload.type || payload.event || '');
  if (eventType !== 'InboundMessage' && eventType.toLowerCase() !== 'inboundmessage') {
    return null;
  }

  const root =
    payload.data && typeof payload.data === 'object'
      ? (payload.data as Record<string, unknown>)
      : payload;

  const messageType = String(root.messageType || root.channel || '').toUpperCase();
  if (messageType !== 'SMS') return null;

  const direction = String(root.direction || 'inbound').toLowerCase();
  if (direction !== 'inbound') return null;

  const locationId = String(root.locationId || payload.locationId || '');
  const contactId = String(root.contactId || payload.contactId || '');
  const body = String(root.body || root.message || root.text || '').trim();
  const messageId =
    root.id != null ? String(root.id) : root.messageId != null ? String(root.messageId) : null;

  if (!locationId || !contactId || !body) return null;

  let contactName: string | null = null;
  if (root.contact && typeof root.contact === 'object') {
    const c = root.contact as Record<string, unknown>;
    contactName = [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || null;
  }

  return { locationId, contactId, body, messageId, contactName };
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
}): Promise<{ ok: boolean; error?: string }> {
  const { venueId, locationId, contactId, messageBody, ghlMessageId, contactName } = params;
  if (!messageBody?.trim()) return { ok: true };

  if (ghlMessageId) {
    const { data: dup } = await supabaseAdmin
      .from('conversation_messages')
      .select('id')
      .eq('ghl_message_id', ghlMessageId)
      .maybeSingle();
    if (dup) return { ok: true };
  }

  const customerId = await upsertVenueCustomerFromGhl({ venueId, locationId, contactId });
  if (!customerId) return { ok: false, error: 'no_customer' };

  const threadId = await ensureSmsThread(venueId, customerId);
  if (!threadId) return { ok: false, error: 'no_thread' };

  const { error: insErr } = await supabaseAdmin.from('conversation_messages').insert({
    thread_id: threadId,
    visibility: 'external',
    channel: 'sms',
    body: messageBody.trim(),
    sender_kind: 'contact',
    contact_from_name: contactName?.trim() || null,
    contact_from_email: null,
    ghl_message_id: ghlMessageId || null,
  });
  if (insErr) {
    console.error('[ghl-sms] insert message', insErr);
    return { ok: false, error: insErr.message };
  }
  return { ok: true };
}
