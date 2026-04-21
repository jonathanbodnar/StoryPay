import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  firstEmailFromList,
  hashInboundDedupeFallback,
  insertInboundConversationEmail,
  parseFromHeader,
  parseReplyLocalPart,
  verifyReplySignature,
} from '@/lib/conversations-inbound-email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Inbound conversation replies (contact → venue thread).
 *
 * **Resend** (recommended if you only use Resend):
 * - Enable Receiving on a domain / subdomain; point MX to Resend (see https://resend.com/inbound ).
 * - Create a webhook for `email.received` → `https://YOUR_HOST/api/webhooks/inbound-email?token=...`
 * - Env: `RESEND_API_KEY`, `CONVERSATIONS_INBOUND_SECRET`, `CONVERSATIONS_INBOUND_DOMAIN`
 * - Optional: `INBOUND_EMAIL_WEBHOOK_TOKEN` (query `token`) to block random posts.
 *
 * **SendGrid Inbound Parse** (multipart/form-data):
 * - MX → SendGrid; POST URL as above.
 *
 * Outbound `Reply-To` is set in `messages/route.ts` via `buildConversationsReplyToEmail` when secret + domain exist.
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
    return NextResponse.json({ ok: true, skipped: 'missing_from_or_to' });
  }

  const toEmail = firstEmailFromList(toRaw);
  const local = toEmail.split('@')[0] ?? '';
  const parsed = parseReplyLocalPart(local);
  if (!parsed) {
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
    console.error('[inbound-email] ingest', r.error);
    return NextResponse.json({ error: r.error ?? 'insert_failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, inserted: r.inserted ?? false });
}

async function handleResendWebhook(request: NextRequest): Promise<NextResponse> {
  const raw = await request.text();
  let event: { type?: string; data?: { email_id?: string } };
  try {
    event = JSON.parse(raw) as typeof event;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (event.type !== 'email.received' || !event.data?.email_id) {
    return NextResponse.json({ ok: true, skipped: 'not_email_received' });
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.error('[inbound-email] RESEND_API_KEY missing — cannot fetch received email body');
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
    subject?: string;
    text?: string | null;
    html?: string | null;
    message_id?: string;
  };

  const fromRaw = email.from ?? '';
  const toRaw = Array.isArray(email.to) && email.to.length ? email.to[0] : '';
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

async function handleSendGridInboundParse(request: NextRequest): Promise<NextResponse> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 });
  }

  const fromRaw = String(form.get('from') ?? form.get('sender') ?? '');
  let toRaw = String(form.get('to') ?? '');
  if (!toRaw.trim()) {
    const envRaw = form.get('envelope');
    if (envRaw && typeof envRaw === 'string') {
      try {
        const env = JSON.parse(envRaw) as { to?: string[] };
        if (Array.isArray(env.to) && env.to[0]) toRaw = env.to[0];
      } catch {
        /* ignore */
      }
    }
  }
  const subject = String(form.get('subject') ?? '') || null;
  let text = String(form.get('text') ?? '');
  const html = String(form.get('html') ?? '');

  const headersRaw = String(form.get('headers') ?? '');
  let messageId: string | null = null;
  if (headersRaw) {
    const mid = /^Message-ID:\s*(.+)$/im.exec(headersRaw);
    if (mid) messageId = mid[1].trim().replace(/^<|>$/g, '');
  }
  if (!messageId) {
    const mid = String(form.get('message-id') ?? form.get('Message-ID') ?? '').trim();
    if (mid) messageId = mid.replace(/^<|>$/g, '');
  }

  return ingestFromParsedFields({
    fromRaw,
    toRaw,
    subject,
    text,
    html,
    messageId,
  });
}

export async function POST(request: NextRequest) {
  const token = process.env.INBOUND_EMAIL_WEBHOOK_TOKEN?.trim();
  if (token) {
    const q = request.nextUrl.searchParams.get('token') ?? '';
    if (q !== token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const ct = request.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    return handleResendWebhook(request);
  }

  return handleSendGridInboundParse(request);
}
