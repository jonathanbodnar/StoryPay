import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { notifyOwnerNewMessage } from '@/lib/owner-notifications';

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

/**
 * Reply-To address for a "Venue Direct" email (concierge ↔ venue staff).
 * Local part: vd+{threadId}+{sig16}.
 *
 * Same signing scheme as the bride-conversation reply-to, but a different
 * prefix so the inbound webhook can route the reply to the venue_direct
 * audience (visible to concierge + venue, hidden from bride) instead of
 * inserting it as an external bride message.
 */
export function buildVenueDirectReplyToEmail(threadId: string, venueId: string): string | null {
  const secret = process.env.CONVERSATIONS_INBOUND_SECRET?.trim();
  const domain = process.env.CONVERSATIONS_INBOUND_DOMAIN?.trim();
  if (!secret || !domain) return null;
  const sig = inboundReplySignature(threadId, venueId, secret);
  return `vd+${threadId}+${sig}@${domain}`;
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

/** Like {@link parseReplyLocalPart} but for the `vd+...` venue-direct prefix. */
export function parseVenueDirectLocalPart(
  localPart: string,
): { threadId: string; sig: string } | null {
  const parts = localPart.split('+');
  if (parts.length !== 3 || parts[0] !== 'vd') return null;
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

// stripHtml: retained for future use (currently unused after the body is
// pre-stripped upstream). Underscore prefix opts out of the unused-var lint.
function _stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
void _stripHtml;

/** Extract first email from a To/Cc string (display names / angle brackets). */
export function firstEmailFromList(raw: string): string {
  const s = (raw ?? '').trim();
  const m = /<?([^\s<>,]+@[^\s<>,>]+)>?/i.exec(s);
  return (m ? m[1] : s).trim().toLowerCase();
}

function normalizeRecipientChunks(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.flatMap((x) => normalizeRecipientChunks(x));
  if (typeof v === 'string') {
    return v
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

const INBOUND_HEADER_KEYS = [
  'delivered-to',
  'envelope-to',
  'x-original-to',
  'x-forwarded-to',
  'to',
] as const;

/**
 * Resend's `to` array is not always ordered with our `reply+{thread}+{sig}@...` first.
 * Scan To, Cc, and common envelope headers for the routing local part.
 */
export function pickReplyRoutingAddressFromInboundEmail(email: {
  to?: unknown;
  cc?: unknown;
  headers?: unknown;
}): string {
  const chunks: string[] = [];
  const push = (u: unknown) => chunks.push(...normalizeRecipientChunks(u));

  push(email.to);
  push(email.cc);

  const headers = email.headers;
  if (headers && typeof headers === 'object' && !Array.isArray(headers)) {
    const h = headers as Record<string, unknown>;
    for (const key of INBOUND_HEADER_KEYS) {
      const direct = h[key];
      if (direct != null) push(direct);
      const title =
        key.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('-');
      if (title !== key && h[title] != null) push(h[title]);
    }
  }

  for (const raw of chunks) {
    const addr = firstEmailFromList(raw);
    const local = addr.split('@')[0] ?? '';
    if (parseReplyLocalPart(local) || parseVenueDirectLocalPart(local)) return raw.trim();
  }
  return '';
}

/** Strict match, plus Gmail-style dots in the local part (contact vs MUA From). */
export function inboundReplyFromMatchesContact(storedEmail: string, fromEmail: string): boolean {
  const a = storedEmail.trim().toLowerCase();
  const b = fromEmail.trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  const [al, ad] = a.split('@');
  const [bl, bd] = b.split('@');
  if (!al || !ad || !bl || !bd || ad !== bd) return false;
  const gmail = ad === 'gmail.com' || ad === 'googlemail.com';
  if (gmail && al.replace(/\./g, '') === bl.replace(/\./g, '')) return true;
  return false;
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
  // We intentionally do NOT require external_reply_channel === 'email' here.
  // The reply landed at our `reply+{threadId}+{sig}@inbound-domain` address
  // with a valid HMAC, which is proof enough that this email belongs to
  // this thread. A thread can be used for both SMS and email — once the
  // user sends an SMS in a previously-email thread, external_reply_channel
  // flips to 'sms' as the default-compose hint, but inbound emails should
  // still land in the same thread the bride is replying to.

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
  const fromNorm = fromEmail.trim().toLowerCase();
  if (!expectedEmail || !inboundReplyFromMatchesContact(expectedEmail, fromNorm)) {
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

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from('conversation_messages')
    .insert(row)
    .select('id, created_at')
    .single();
  if (insErr) {
    if (insErr.code === '23505') return { ok: true, inserted: false };
    console.error('[inbound-email] insert', insErr);
    return { ok: false, error: insErr.message };
  }

  // Auto-reopen: if the support team previously closed this thread but the
  // bride is replying again, surface it back in the Needs Reply inbox.
  // Best-effort — silently ignore if the status column isn't present yet.
  void supabaseAdmin
    .from('conversation_threads')
    .update({ status: 'open' })
    .eq('id', threadId)
    .eq('status', 'closed')
    .then(() => undefined, () => undefined);

  if (inserted) {
    void (async () => {
      try {
        const { broadcastBrideMessage } = await import('@/lib/realtime/broadcast');
        await broadcastBrideMessage({
          inbound:            true,
          threadId,
          venueId,
          venueCustomerId:    customerId,
          messageId:          (inserted as { id: string }).id,
          body,
          channel:            'email',
          senderKind:         'contact',
          sentByVenueSupport: false,
          supportAgentId:     null,
          createdAt:          (inserted as { created_at?: string }).created_at || new Date().toISOString(),
        });
      } catch (e) {
        console.warn('[inbound-email] broadcast failed', e);
      }
    })();

    // Owner push — fires only when push is enabled and push_new_message is on.
    // No-op for venues that haven't opted in.
    notifyOwnerNewMessage({
      venueId,
      threadId,
      fromName,
      fromEmail,
      bodyText: body,
    });
  }

  return { ok: true, inserted: true };
}

export function hashInboundDedupeFallback(from: string, subject: string, body: string, dateHint: string): string {
  return `no-msgid:${createHash('sha256').update([from, subject, body, dateHint].join('\0')).digest('hex').slice(0, 40)}`;
}

/**
 * Ingest an inbound email reply to a Venue Direct thread.
 *
 * The sender MUST be either the venue's billing/owner email OR an active
 * venue_team_members.email for the venue that owns the thread. Otherwise we
 * reject the email so a stranger can't poison a venue_direct stream just
 * because they got CC'd on the original.
 *
 * Inserts a conversation_messages row with:
 *   audience='venue_direct', visibility='internal', sender_kind='owner'|'team',
 *   support_only=false, contact_from_name/email recorded for display.
 */
export async function insertInboundVenueDirectEmail(params: {
  threadId: string;
  venueId: string;
  fromEmail: string;
  fromName: string | null;
  subject: string | null;
  bodyText: string;
  smtpMessageId: string | null;
}): Promise<{ ok: boolean; error?: string; inserted?: boolean; messageId?: string; venueCustomerId?: string }> {
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
    .select('id, venue_id, venue_customer_id')
    .eq('id', threadId)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (tErr || !thread) {
    console.warn('[venue-direct-inbound] thread_not_found', { threadId, venueId });
    return { ok: false, error: 'thread_not_found' };
  }

  // Resolve sender: check venue owner email first, then team members.
  // The HMAC-signed Reply-To address is the real security boundary here —
  // having the address means you received the original outbound email. So
  // we accept any reply that hits this address, but tag it with the
  // strongest match we can find (owner / team member / generic email).
  const fromNorm = fromEmail.trim().toLowerCase();
  const { data: venueRow } = await supabaseAdmin
    .from('venues')
    .select('id, email, notification_email')
    .eq('id', venueId)
    .maybeSingle();
  const v = venueRow as { email?: string | null; notification_email?: string | null } | null;
  const ownerEmails = [v?.email, v?.notification_email]
    .filter(Boolean)
    .map(e => (e as string).trim().toLowerCase());

  let isOwner = ownerEmails.some(e => e === fromNorm);
  let memberId: string | null = null;
  if (!isOwner) {
    const { data: members } = await supabaseAdmin
      .from('venue_team_members')
      .select('id, email, status')
      .eq('venue_id', venueId);
    type MemberRow = { id: string; email: string | null; status: string | null };
    const matches = ((members ?? []) as MemberRow[])
      .filter(x => x.email && x.email.trim().toLowerCase() === fromNorm);
    const m = matches.find(x => x.status !== 'inactive') ?? matches[0] ?? null;
    if (m) memberId = m.id;
  }
  if (memberId) isOwner = false;

  // Choose sender_kind: 'owner' if matched venue.email, 'team' if matched a
  // team member, otherwise default to 'team' (the email reached us via the
  // signed venue_direct address, so it's coming from someone the venue
  // looped in — treat as team for display purposes). The actual identity is
  // preserved in contact_from_email for the support agent to verify.
  const senderKind = memberId ? 'team' : (isOwner ? 'owner' : 'team');

  console.warn('[venue-direct-inbound] accepting', {
    threadId,
    venueId,
    fromEmail: fromNorm,
    matchedOwner: isOwner,
    matchedMemberId: memberId,
    senderKind,
  });

  const row: Record<string, unknown> = {
    thread_id:               threadId,
    visibility:              'internal',
    channel:                 'email',
    body,
    sender_kind:             senderKind,
    venue_team_member_id:    memberId,
    contact_from_name:       fromName?.trim() || null,
    contact_from_email:      fromEmail.trim().toLowerCase(),
    audience:                'venue_direct',
    support_only:            false,
    email_subject:           subject?.trim() || null,
    smtp_message_id:         smtpMessageId || null,
    external_email_sent:     false,
    send_error:              null,
  };

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from('conversation_messages')
    .insert(row)
    .select('id, created_at')
    .single();

  if (insErr) {
    if (insErr.code === '23505') return { ok: true, inserted: false };
    console.error('[venue-direct-inbound] insert', insErr);
    return { ok: false, error: insErr.message };
  }

  const t = thread as { venue_customer_id: string };
  if (inserted) {
    void (async () => {
      try {
        const { broadcastBrideMessageAdminOnly } = await import('@/lib/realtime/broadcast');
        await broadcastBrideMessageAdminOnly({
          inbound:                 false,
          threadId,
          venueId,
          venueCustomerId:         t.venue_customer_id,
          messageId:               (inserted as { id: string }).id,
          body,
          channel:                 'email',
          senderKind:              memberId ? 'team' : 'owner',
          sentByVenueSupport:      false,
          supportAgentId:          null,
          createdAt:               (inserted as { created_at?: string }).created_at || new Date().toISOString(),
          supportOnly:             false,
          mentionedSupportUserIds: [],
        });
      } catch (e) {
        console.warn('[venue-direct-inbound] broadcast failed', e);
      }
    })();
  }

  return {
    ok: true,
    inserted: true,
    messageId: (inserted as { id: string }).id,
    venueCustomerId: t.venue_customer_id,
  };
}
