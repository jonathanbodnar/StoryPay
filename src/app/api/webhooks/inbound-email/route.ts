import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
import {
  firstEmailFromList,
  hashInboundDedupeFallback,
  insertInboundConversationEmail,
  insertInboundVenueDirectEmail,
  parseFromHeader,
  parseReplyLocalPart,
  parseVenueDirectLocalPart,
  pickReplyRoutingAddressFromInboundEmail,
  verifyReplySignature,
} from '@/lib/conversations-inbound-email';
import { haltAutomationEnrollmentsForReply } from '@/lib/marketing-email-worker';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * After a contact reply is successfully ingested, halt any active marketing
 * automation enrollments for that contact and tell the venue owner. This is
 * the "if they reply, sequence ends + notify team" piece of speed-to-lead.
 */
async function haltAndNotifyOnReply(
  venueId: string,
  fromEmail: string,
  fromName: string | null,
  subject: string | null,
  bodyPreview: string,
): Promise<void> {
  try {
    const { data: lead } = await supabaseAdmin
      .from('leads')
      .select('id, name, first_name, last_name, email')
      .eq('venue_id', venueId)
      .ilike('email', fromEmail)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!lead?.id) return;

    const halted = await haltAutomationEnrollmentsForReply(
      venueId,
      lead.id as string,
      'email_reply',
    );
    if (halted <= 0) return;

    const { data: venue } = await supabaseAdmin
      .from('venues')
      .select('id, name, email, notification_email, email_notifications')
      .eq('id', venueId)
      .maybeSingle();
    const notifyEnabled = (venue as { email_notifications?: boolean } | null)?.email_notifications !== false;
    if (!notifyEnabled) return;

    const notifyTo =
      (venue as { notification_email?: string | null } | null)?.notification_email ||
      (venue as { email?: string | null } | null)?.email ||
      null;
    if (!notifyTo) return;

    const venueName = (venue as { name?: string | null } | null)?.name ?? 'your venue';
    const contactDisplay =
      [
        (lead as { first_name?: string | null }).first_name ?? '',
        (lead as { last_name?: string | null }).last_name ?? '',
      ]
        .filter(Boolean)
        .join(' ')
        .trim() ||
      (lead as { name?: string | null }).name ||
      fromName ||
      fromEmail;

    const preview = bodyPreview.slice(0, 320);
    const html = `
      <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;color:#1b1b1b;">
        <h2 style="margin:0 0 8px;">${escapeHtml(contactDisplay)} replied</h2>
        <p style="margin:0 0 12px;color:#555;">Their automated follow-up sequence has been paused.</p>
        <p style="margin:0 0 4px;color:#666;font-size:12px;">From</p>
        <p style="margin:0 0 12px;">${escapeHtml(fromEmail)}</p>
        ${subject ? `<p style="margin:0 0 4px;color:#666;font-size:12px;">Subject</p><p style="margin:0 0 12px;">${escapeHtml(subject)}</p>` : ''}
        ${preview ? `<p style="margin:0 0 4px;color:#666;font-size:12px;">Message preview</p><p style="margin:0 0 16px;white-space:pre-wrap;">${escapeHtml(preview)}</p>` : ''}
        <p style="margin:0;color:#888;font-size:12px;">${halted} active workflow${halted === 1 ? '' : 's'} stopped for this contact.</p>
      </div>`;

    await sendEmail({
      to: notifyTo,
      subject: `Reply received: ${contactDisplay} — ${venueName}`,
      html,
      replyTo: fromEmail,
    }).catch((e) => console.warn('[inbound-email] reply-notification email failed:', e));
  } catch (e) {
    console.warn('[inbound-email] haltAndNotifyOnReply failed:', e);
  }
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Resend **email.received** webhook → conversation thread (contact reply).
 *
 * 1. Receiving: add domain in Resend, point MX records (https://resend.com/inbound ).
 * 2. Webhook: subscribe to `email.received` → `https://YOUR_HOST/api/webhooks/inbound-email?token=...`
 * 3. Env: `RESEND_API_KEY`, `CONVERSATIONS_INBOUND_SECRET`, `CONVERSATIONS_INBOUND_DOMAIN`
 * 4. Optional `INBOUND_EMAIL_WEBHOOK_TOKEN` (query `token`).
 *
 * Outbound `Reply-To` is set in `conversations/.../messages/route.ts` when secret + domain exist.
 */

async function ingestFromParsedFields(params: {
  fromRaw: string;
  toRaw: string;
  subject: string | null;
  text: string;
  html: string;
  messageId: string | null;
  resendEmailId?: string;
}): Promise<NextResponse> {
  const { fromRaw, toRaw, subject, text: textIn, html, messageId, resendEmailId } = params;

  let text = textIn.trim();
  if (!text && html.trim()) {
    text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const { email: fromEmail, name: fromName } = parseFromHeader(fromRaw);
  if (!fromEmail || !toRaw.trim()) {
    console.warn('[inbound-email] skipped: missing_from_or_to');
    return NextResponse.json({ ok: true, skipped: 'missing_from_or_to' });
  }

  const toEmail = firstEmailFromList(toRaw);
  const local = toEmail.split('@')[0] ?? '';
  const parsedBride = parseReplyLocalPart(local);
  const parsedVD = !parsedBride ? parseVenueDirectLocalPart(local) : null;
  const parsed = parsedBride ?? parsedVD;
  if (!parsed) {
    console.warn('[inbound-email] skipped: not_reply_address', { local: local.slice(0, 72) });
    return NextResponse.json({ ok: true, skipped: 'not_reply_address' });
  }

  const { data: thread } = await supabaseAdmin
    .from('conversation_threads')
    .select('venue_id')
    .eq('id', parsed.threadId)
    .maybeSingle();

  const venueId = (thread as { venue_id?: string } | null)?.venue_id;
  if (!venueId || !verifyReplySignature(parsed.threadId, venueId, parsed.sig)) {
    console.warn('[inbound-email] bad signature or thread', parsed.threadId);
    return NextResponse.json({ ok: true, skipped: 'bad_token' });
  }

  const mid =
    (messageId && messageId.replace(/^<|>$/g, '')) ||
    (resendEmailId ? `resend:${resendEmailId}` : null);
  const smtpId =
    mid ||
    (text ? hashInboundDedupeFallback(fromEmail, subject ?? '', text, toRaw) : null);

  // Venue Direct path: replies from venue staff to a `vd+...@` address are
  // routed into the venue_direct audience so they show up in the support
  // inbox + the venue's Concierge tab.
  if (parsedVD) {
    const r = await insertInboundVenueDirectEmail({
      threadId:      parsedVD.threadId,
      venueId,
      fromEmail,
      fromName,
      subject,
      bodyText:      text || '(no body)',
      smtpMessageId: smtpId,
    });
    if (!r.ok) {
      const skippable = new Set(['sender_not_authorized', 'thread_not_found']);
      if (r.error && skippable.has(r.error)) {
        console.warn('[inbound-email] vd skipped:', r.error, { threadId: parsedVD.threadId });
        return NextResponse.json({ ok: true, skipped: r.error });
      }
      console.error('[inbound-email] vd ingest', r.error);
      return NextResponse.json({ error: r.error ?? 'insert_failed' }, { status: 500 });
    }
    return NextResponse.json({ ok: true, inserted: r.inserted ?? false, audience: 'venue_direct' });
  }

  const r = await insertInboundConversationEmail({
    threadId: parsed.threadId,
    venueId,
    fromEmail,
    fromName,
    subject,
    bodyText: text || '(no body)',
    smtpMessageId: smtpId,
  });

  if (!r.ok) {
    const skippable = new Set(['from_mismatch', 'thread_not_found', 'thread_not_email']);
    if (r.error && skippable.has(r.error)) {
      console.warn('[inbound-email] skipped ingest:', r.error, { threadId: parsed.threadId });
      return NextResponse.json({ ok: true, skipped: r.error });
    }
    console.error('[inbound-email] ingest', r.error);
    return NextResponse.json({ error: r.error ?? 'insert_failed' }, { status: 500 });
  }

  if (!r.inserted && text.trim()) {
    console.warn('[inbound-email] no row inserted (duplicate or empty body?)', {
      threadId: parsed.threadId,
    });
  }

  // Speed-to-lead: a freshly-ingested reply should stop any active
  // marketing automation enrollments for this contact and ping the venue.
  // We only fire on the first ingest of a given message (r.inserted) so we
  // don't re-halt or re-email on duplicate webhook deliveries.
  if (r.inserted) {
    await haltAndNotifyOnReply(
      venueId,
      fromEmail.toLowerCase(),
      fromName ?? null,
      subject,
      text,
    );
  }

  return NextResponse.json({ ok: true, inserted: r.inserted ?? false });
}

export async function POST(request: NextRequest) {
  const token = process.env.INBOUND_EMAIL_WEBHOOK_TOKEN?.trim();
  if (token) {
    const q = request.nextUrl.searchParams.get('token') ?? '';
    if (q !== token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const raw = await request.text();
  let event: { type?: string; data?: { email_id?: string } };
  try {
    event = JSON.parse(raw) as typeof event;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const ct = request.headers.get('content-type') ?? '';
  if (!ct.includes('application/json') && typeof event.type !== 'string') {
    return NextResponse.json(
      {
        error: 'Expected application/json (Resend email.received webhook)',
      },
      { status: 415 },
    );
  }

  if (event.type !== 'email.received' || !event.data?.email_id) {
    return NextResponse.json({ ok: true, skipped: 'not_email_received' });
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.error('[inbound-email] RESEND_API_KEY missing');
    return NextResponse.json({ error: 'RESEND_API_KEY not configured' }, { status: 503 });
  }

  const emailId = event.data.email_id;
  const res = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    const t = await res.text();
    console.error('[inbound-email] Resend receiving API', res.status, t);
    return NextResponse.json({ error: 'resend_receiving_fetch_failed' }, { status: 502 });
  }

  const email = (await res.json()) as {
    from?: string;
    to?: string[];
    cc?: string[];
    subject?: string;
    text?: string | null;
    html?: string | null;
    message_id?: string;
    headers?: Record<string, unknown>;
  };

  const fromRaw = email.from ?? '';
  const replyRoute = pickReplyRoutingAddressFromInboundEmail(email);
  const toRaw =
    replyRoute ||
    (Array.isArray(email.to) && email.to.length ? String(email.to[0]) : '');
  if (toRaw) {
    const local = firstEmailFromList(toRaw).split('@')[0] ?? '';
    if (!parseReplyLocalPart(local)) {
      console.warn('[inbound-email] no reply+thread+sig in to/cc/headers', {
        usedFallbackTo: !replyRoute,
        toPreview: JSON.stringify(email.to ?? []).slice(0, 160),
      });
    }
  }
  const subject = email.subject ? String(email.subject) : null;
  const messageId = email.message_id ? String(email.message_id) : null;

  return ingestFromParsedFields({
    fromRaw,
    toRaw,
    subject,
    text: String(email.text ?? ''),
    html: String(email.html ?? ''),
    messageId,
    resendEmailId: emailId,
  });
}
