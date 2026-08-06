/**
 * Inbound-email routing for Venue Support tickets (support@storyvenue.com).
 *
 * support@storyvenue.com is a Google Workspace Group (no real mailbox) that
 * forwards ALL mail to a fixed address at the existing Resend inbound
 * receiving domain: support@{CONVERSATIONS_INBOUND_DOMAIN}. Resend's
 * `email.received` webhook (src/app/api/webhooks/inbound-email/route.ts)
 * already handles that domain for bride/venue-direct reply routing — this
 * module adds a third local-part scheme so the SAME webhook + domain can
 * also route Venue Support ticket mail, with zero new DNS.
 *
 * Two ways mail lands here:
 *   1. Brand-new mail / cold inquiries — arrives at the fixed catch-all
 *      address `support@{domain}` (the Workspace Group's forward target).
 *      No ticket is known yet: resolve the sender against venues /
 *      venue_team_members, then create-or-append a ticket.
 *   2. Replies to an agent's outbound ticket-reply email — arrives at the
 *      signed `ticket+{ticketId}+{sig}@{domain}` Reply-To address set on
 *      that email (see buildTicketReplyToEmail). Always appends to that
 *      exact ticket.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { notifySupportTicket, notifyTicketReply } from '@/lib/slack-notify';
import { broadcastTicketMessage } from '@/lib/realtime/broadcast';
import type { SupportAttachment } from '@/lib/support/support-attachments-bucket';

/** Fixed local part the Google Group (support@storyvenue.com) forwards to. */
export const SUPPORT_TICKET_INBOUND_LOCAL_PART =
  (process.env.SUPPORT_TICKET_INBOUND_LOCAL_PART?.trim() || 'support').toLowerCase();

function hexToBuf(hex: string): Buffer | null {
  if (!/^[a-f0-9]+$/i.test(hex) || hex.length % 2) return null;
  return Buffer.from(hex, 'hex');
}

/** HMAC hex (16 chars) — must match parseTicketReplyLocalPart / buildTicketReplyToEmail. */
export function ticketReplySignature(ticketId: string, secret: string): string {
  return createHmac('sha256', secret).update(`ticket|${ticketId}`).digest('hex').slice(0, 16);
}

/**
 * Reply-To address for an outbound agent reply to a Venue Support ticket, so
 * the client's reply routes back into this exact ticket instead of the
 * support@storyvenue.com Workspace Group (no mailbox to read from there).
 * Local part: ticket+{ticketId}+{sig16}.
 */
export function buildTicketReplyToEmail(ticketId: string): string | null {
  const secret = process.env.CONVERSATIONS_INBOUND_SECRET?.trim();
  const domain = process.env.CONVERSATIONS_INBOUND_DOMAIN?.trim();
  if (!secret || !domain) return null;
  const sig = ticketReplySignature(ticketId, secret);
  return `ticket+${ticketId}+${sig}@${domain}`;
}

export function parseTicketReplyLocalPart(localPart: string): { ticketId: string; sig: string } | null {
  const parts = localPart.split('+');
  if (parts.length !== 3 || parts[0] !== 'ticket') return null;
  const ticketId = parts[1];
  const sig = parts[2];
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(ticketId)) return null;
  if (!/^[a-f0-9]{16}$/i.test(sig)) return null;
  return { ticketId, sig: sig.toLowerCase() };
}

export function verifyTicketReplySignature(ticketId: string, sig: string): boolean {
  const secret = process.env.CONVERSATIONS_INBOUND_SECRET?.trim();
  if (!secret) return false;
  const expected = ticketReplySignature(ticketId, secret);
  try {
    const a = hexToBuf(expected);
    const b = hexToBuf(sig.toLowerCase());
    if (!a || !b || a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export interface ResolvedTicketVenue {
  venueId:   string;
  venueName: string;
}

/**
 * Resolve an inbound sender's email against known venues / venue team
 * members — mirrors the sender-resolution approach used by
 * insertInboundVenueDirectEmail() for the existing venue-direct inbound path.
 */
export async function resolveVenueForSenderEmail(email: string): Promise<ResolvedTicketVenue | null> {
  const norm = email.trim().toLowerCase();
  if (!norm || !norm.includes('@')) return null;

  const { data: venueMatch } = await supabaseAdmin
    .from('venues')
    .select('id, name, email, notification_email')
    .or(`email.ilike.${norm},notification_email.ilike.${norm}`)
    .limit(1)
    .maybeSingle();
  if (venueMatch) {
    const v = venueMatch as { id: string; name: string | null };
    return { venueId: v.id, venueName: v.name || 'Venue' };
  }

  const { data: memberMatch } = await supabaseAdmin
    .from('venue_team_members')
    .select('id, venue_id, email, status')
    .ilike('email', norm)
    .neq('status', 'inactive')
    .limit(1)
    .maybeSingle();
  if (memberMatch) {
    const m = memberMatch as { venue_id: string };
    const { data: v } = await supabaseAdmin
      .from('venues')
      .select('id, name')
      .eq('id', m.venue_id)
      .maybeSingle();
    return { venueId: m.venue_id, venueName: (v as { name?: string } | null)?.name || 'Venue' };
  }

  return null;
}

interface TicketRow {
  id:      string;
  venue_id: string | null;
  status:   'open' | 'pending' | 'closed';
  subject:  string;
}

async function findAppendTarget(opts: {
  venueId: string | null;
  fromEmail: string;
}): Promise<TicketRow | null> {
  let q = supabaseAdmin
    .from('support_threads')
    .select('id, venue_id, status, subject')
    .eq('source', 'inbound_email')
    .in('status', ['open', 'pending'])
    .order('last_message_at', { ascending: false })
    .limit(1);

  q = opts.venueId
    ? q.eq('venue_id', opts.venueId)
    : q.eq('is_unmatched', true).ilike('contact_email', opts.fromEmail);

  const { data } = await q.maybeSingle();
  return (data as TicketRow | null) ?? null;
}

async function appendMessage(params: {
  ticket: TicketRow;
  fromEmail: string;
  fromName: string | null;
  bodyText: string;
  smtpMessageId: string | null;
  isNewTicket: boolean;
  venueName: string;
  attachments?: SupportAttachment[];
}): Promise<{ ok: true; ticketId: string; inserted: boolean }> {
  const { ticket, fromEmail, fromName, bodyText, smtpMessageId, isNewTicket, venueName, attachments } = params;

  if (!isNewTicket) {
    if (smtpMessageId) {
      const { data: dup } = await supabaseAdmin
        .from('support_thread_messages')
        .select('id')
        .eq('smtp_message_id', smtpMessageId)
        .maybeSingle();
      if (dup) return { ok: true, ticketId: ticket.id, inserted: false };
    }

    const insertRow: Record<string, unknown> = {
      support_thread_id:   ticket.id,
      sender_type:         'venue',
      body:                bodyText,
      contact_from_name:   fromName?.trim() || null,
      contact_from_email:  fromEmail.trim().toLowerCase(),
      smtp_message_id:     smtpMessageId || null,
    };
    if (attachments?.length) insertRow.attachments = attachments;

    const { data: msg, error: mErr } = await supabaseAdmin
      .from('support_thread_messages')
      .insert(insertRow)
      .select('id, created_at')
      .single();

    if (mErr || !msg) {
      if (mErr?.code === '23505') return { ok: true, ticketId: ticket.id, inserted: false };
      console.error('[ticket-inbound-email] append insert failed', mErr);
      return { ok: true, ticketId: ticket.id, inserted: false };
    }

    // A client reply always reopens the ticket (mirrors the venue-dashboard
    // reply endpoint) — the only state that stays unchanged is 'open'.
    let nextStatus: 'open' | 'pending' | 'closed' = ticket.status;
    if (ticket.status !== 'open') {
      await supabaseAdmin
        .from('support_threads')
        .update({ status: 'open', updated_at: new Date().toISOString() })
        .eq('id', ticket.id);
      nextStatus = 'open';
    }

    void broadcastTicketMessage({
      ticketId:   ticket.id,
      venueId:    ticket.venue_id ?? '',
      messageId:  (msg as { id: string }).id,
      senderType: 'venue',
      body:       bodyText,
      createdAt:  (msg as { created_at?: string }).created_at || new Date().toISOString(),
      status:     nextStatus,
    });

    // This is exactly the "follow-up reply on an already-open ticket" case —
    // make sure it pings the shared Slack channel like every other inbound
    // message does.
    void notifyTicketReply({
      venueName,
      subject:        ticket.subject,
      messagePreview: bodyText,
      ticketId:       ticket.id,
    }).catch(() => {});
  }

  return { ok: true, ticketId: ticket.id, inserted: true };
}

/**
 * Handle mail landing at the fixed support@{domain} catch-all address —
 * i.e. brand-new mail with no known ticket yet (new tickets AND unmatched /
 * cold-inquiry senders).
 */
export async function ingestNewInboundSupportEmail(params: {
  fromEmail: string;
  fromName: string | null;
  subject: string | null;
  bodyText: string;
  smtpMessageId: string | null;
  attachments?: SupportAttachment[];
}): Promise<{ ok: boolean; ticketId?: string; inserted?: boolean; error?: string }> {
  const { fromEmail, fromName, subject, bodyText, smtpMessageId, attachments } = params;
  const body = bodyText.trim();
  if (!body) return { ok: true, inserted: false };

  if (smtpMessageId) {
    const { data: dup } = await supabaseAdmin
      .from('support_thread_messages')
      .select('id')
      .eq('smtp_message_id', smtpMessageId)
      .maybeSingle();
    if (dup) return { ok: true, inserted: false };
  }

  const resolved = await resolveVenueForSenderEmail(fromEmail);
  const existing = await findAppendTarget({ venueId: resolved?.venueId ?? null, fromEmail });

  if (existing) {
    const r = await appendMessage({
      ticket:        existing,
      fromEmail,
      fromName,
      bodyText:      body,
      smtpMessageId,
      isNewTicket:   false,
      venueName:     resolved?.venueName ?? existing.subject,
      attachments,
    });
    return { ok: true, ticketId: r.ticketId, inserted: r.inserted };
  }

  // No open/pending inbound-email ticket to append to — open a new one.
  const ticketInsert: Record<string, unknown> = {
    venue_id:             resolved?.venueId ?? null,
    subject:              (subject?.trim() || 'Support request (email)').slice(0, 200),
    status:               'open',
    priority:             'normal',
    last_message_preview: body.slice(0, 240),
    source:               'inbound_email',
    contact_email:        fromEmail.trim().toLowerCase(),
    contact_name:         fromName?.trim() || null,
    is_unmatched:         !resolved,
  };

  const { data: ticket, error: tErr } = await supabaseAdmin
    .from('support_threads')
    .insert(ticketInsert)
    .select('id, subject')
    .single();

  if (tErr || !ticket) {
    console.error('[ticket-inbound-email] create ticket failed', tErr);
    return { ok: false, error: tErr?.message || 'Failed to create ticket' };
  }

  const ticketId = (ticket as { id: string }).id;
  const ticketSubject = (ticket as { subject: string }).subject;

  const newMsgRow: Record<string, unknown> = {
    support_thread_id:  ticketId,
    sender_type:        'venue',
    body,
    contact_from_name:  fromName?.trim() || null,
    contact_from_email: fromEmail.trim().toLowerCase(),
    smtp_message_id:    smtpMessageId || null,
  };
  if (attachments?.length) newMsgRow.attachments = attachments;

  const { data: msg } = await supabaseAdmin
    .from('support_thread_messages')
    .insert(newMsgRow)
    .select('id, created_at')
    .single();

  if (msg) {
    void broadcastTicketMessage({
      ticketId,
      venueId:    resolved?.venueId ?? '',
      messageId:  (msg as { id: string }).id,
      senderType: 'venue',
      body,
      createdAt:  (msg as { created_at?: string }).created_at || new Date().toISOString(),
      status:     'open',
    });

    void notifySupportTicket({
      venueName:      resolved?.venueName ?? (resolved ? 'Venue' : `Unmatched sender (${fromEmail})`),
      subject:        ticketSubject,
      messagePreview: body,
      ticketId,
    }).catch(() => {});
  }

  return { ok: true, ticketId, inserted: true };
}

/**
 * Handle mail landing at the signed ticket+{ticketId}+{sig}@{domain} address
 * — a client replying to a specific agent outbound email. Always appends to
 * that exact ticket (regardless of match state).
 */
export async function ingestTicketReplyEmail(params: {
  ticketId: string;
  sig: string;
  fromEmail: string;
  fromName: string | null;
  bodyText: string;
  smtpMessageId: string | null;
  attachments?: SupportAttachment[];
}): Promise<{ ok: boolean; skipped?: string; ticketId?: string; inserted?: boolean; error?: string }> {
  const { ticketId, sig, fromEmail, fromName, bodyText, smtpMessageId, attachments } = params;
  const body = bodyText.trim();
  if (!body) return { ok: true, inserted: false };

  if (!verifyTicketReplySignature(ticketId, sig)) {
    return { ok: true, skipped: 'bad_token' };
  }

  const { data: tRow } = await supabaseAdmin
    .from('support_threads')
    .select('id, venue_id, status, subject, contact_email')
    .eq('id', ticketId)
    .maybeSingle();
  if (!tRow) return { ok: true, skipped: 'thread_not_found' };
  const ticket = tRow as TicketRow & { contact_email: string | null };

  let venueName = 'Venue';
  if (ticket.venue_id) {
    const { data: v } = await supabaseAdmin
      .from('venues')
      .select('name')
      .eq('id', ticket.venue_id)
      .maybeSingle();
    venueName = (v as { name?: string } | null)?.name || 'Venue';
  } else {
    venueName = `Unmatched sender (${ticket.contact_email || fromEmail})`;
  }

  const r = await appendMessage({
    ticket,
    fromEmail,
    fromName,
    bodyText: body,
    smtpMessageId,
    isNewTicket: false,
    venueName,
    attachments,
  });
  return { ok: true, ticketId: r.ticketId, inserted: r.inserted };
}
