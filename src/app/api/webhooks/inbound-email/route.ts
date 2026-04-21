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
 * SendGrid Inbound Parse (multipart/form-data): https://docs.sendgrid.com/for-developers/parsing-email/inbound-email
 *
 * Configure MX for CONVERSATIONS_INBOUND_DOMAIN → SendGrid, set POST URL to:
 *   https://YOUR_HOST/api/webhooks/inbound-email?token=INBOUND_EMAIL_WEBHOOK_TOKEN
 *
 * Set env: CONVERSATIONS_INBOUND_SECRET, CONVERSATIONS_INBOUND_DOMAIN, INBOUND_EMAIL_WEBHOOK_TOKEN (optional).
 */
export async function POST(request: NextRequest) {
  const token = process.env.INBOUND_EMAIL_WEBHOOK_TOKEN?.trim();
  if (token) {
    const q = request.nextUrl.searchParams.get('token') ?? '';
    if (q !== token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

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
  if (!text.trim() && html.trim()) {
    text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

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

  const { email: fromEmail, name: fromName } = parseFromHeader(fromRaw);
  if (!fromEmail || !toRaw) {
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

  const smtpId =
    messageId ||
    (text.trim() ? hashInboundDedupeFallback(fromEmail, subject ?? '', text, toRaw) : null);

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
