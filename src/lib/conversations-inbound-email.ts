import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';

function hexToBuf(hex: string): Buffer | null {
  if (!/^[a-f0-9]+$/i.test(hex) || hex.length % 2) return null;
  return Buffer.from(hex, 'hex');
}

/** HMAC hex (16 chars) — must match parseReplyLocalPart / buildConversationsReplyToEmail. */
export function inboundReplySignature(threadId: string, venueId: string, secret: string): string {
  return createHmac('sha256', secret).update(`${threadId}|${venueId}`).digest('hex').slice(0, 16);
}

/**
 * Reply-To address so inbound parse can route back to this thread.
 * Local part: reply+{threadId}+{sig16} (no plus in UUID).
 */
export function buildConversationsReplyToEmail(threadId: string, venueId: string): string | null {
  const secret = process.env.CONVERSATIONS_INBOUND_SECRET?.trim();
  const domain = process.env.CONVERSATIONS_INBOUND_DOMAIN?.trim();
  if (!secret || !domain) return null;
  const sig = inboundReplySignature(threadId, venueId, secret);
  return `reply+${threadId}+${sig}@${domain}`;
}

export function parseReplyLocalPart(
  localPart: string,
): { threadId: string; sig: string } | null {
  const parts = localPart.split('+');
  if (parts.length !== 3 || parts[0] !== 'reply') return null;
  const threadId = parts[1];
  const sig = parts[2];
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(threadId)) return null;
  if (!/^[a-f0-9]{16}$/i.test(sig)) return null;
  return { threadId, sig: sig.toLowerCase() };
}

export function verifyReplySignature(threadId: string, venueId: string, sig: string): boolean {
  const secret = process.env.CONVERSATIONS_INBOUND_SECRET?.trim();
  if (!secret) return false;
  const expected = inboundReplySignature(threadId, venueId, secret);
  try {
    const a = hexToBuf(expected);
    const b = hexToBuf(sig.toLowerCase());
    if (!a || !b || a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function parseFromHeader(fromRaw: string): { email: string; name: string | null } {
  const from = (fromRaw ?? '').trim();
  const m = /<([^>]+@[^>]+)>/.exec(from);
  const email = (m ? m[1] : from).trim().toLowerCase();
  let name: string | null = null;
  if (m && m.index > 0) {
    name = from
      .slice(0, m.index)
      .replace(/^["'\s]+|["'\s]+$/g, '')
      .trim();
    if (!name) name = null;
  }
  return { email, name };
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract first email from a To/Cc string (SendGrid may send display names). */
export function firstEmailFromList(raw: string): string {
  const s = (raw ?? '').trim();
  const m = /<?([^\s<>,]+@[^\s<>,>]+)>?/i.exec(s);
  return (m ? m[1] : s).trim().toLowerCase();
}

export async function insertInboundConversationEmail(params: {
  threadId: string;
  venueId: string;
  fromEmail: string;
  fromName: string | null;
  subject: string | null;
  bodyText: string;
  smtpMessageId: string | null;
}): Promise<{ ok: boolean; error?: string; inserted?: boolean }> {
  const { threadId, venueId, fromEmail, fromName, subject, bodyText, smtpMessageId } = params;
  const body = bodyText.trim();
  if (!body) return { ok: true, inserted: false };

  if (smtpMessageId) {
    const { data: dup } = await supabaseAdmin
      .from('conversation_messages')
      .select('id')
      .eq('smtp_message_id', smtpMessageId)
      .maybeSingle();
    if (dup) return { ok: true, inserted: false };
  }

  const { data: thread, error: tErr } = await supabaseAdmin
    .from('conversation_threads')
    .select('id, venue_customer_id, external_reply_channel')
    .eq('id', threadId)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (tErr || !thread) return { ok: false, error: 'thread_not_found' };
  if ((thread as { external_reply_channel?: string }).external_reply_channel !== 'email') {
    return { ok: false, error: 'thread_not_email' };
  }

  const customerId = (thread as { venue_customer_id: string }).venue_customer_id;
  const { data: contact } = await supabaseAdmin
    .from('venue_customers')
    .select('customer_email')
    .eq('id', customerId)
    .eq('venue_id', venueId)
    .maybeSingle();

  const expectedEmail = ((contact as { customer_email?: string } | null)?.customer_email ?? '')
    .trim()
    .toLowerCase();
  if (!expectedEmail || fromEmail.trim().toLowerCase() !== expectedEmail) {
    return { ok: false, error: 'from_mismatch' };
  }

  const row: Record<string, unknown> = {
    thread_id: threadId,
    visibility: 'external',
    channel: 'email',
    body,
    sender_kind: 'contact',
    contact_from_name: fromName?.trim() || null,
    contact_from_email: fromEmail.trim().toLowerCase(),
    email_subject: subject?.trim() || null,
    smtp_message_id: smtpMessageId || null,
    mentioned_member_ids: [],
    external_email_sent: false,
    send_error: null,
  };

  const { error: insErr } = await supabaseAdmin.from('conversation_messages').insert(row);
  if (insErr) {
    if (insErr.code === '23505') return { ok: true, inserted: false };
    console.error('[inbound-email] insert', insErr);
    return { ok: false, error: insErr.message };
  }
  return { ok: true, inserted: true };
}

export function hashInboundDedupeFallback(from: string, subject: string, body: string, dateHint: string): string {
  return `no-msgid:${createHash('sha256').update([from, subject, body, dateHint].join('\0')).digest('hex').slice(0, 40)}`;
}
