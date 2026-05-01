export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse, type NextRequest } from 'next/server';
import { authenticateApiV1, corsPreflight, CORS_HEADERS } from '@/lib/api-v1-auth';
import { sendEmail } from '@/lib/email';
import { supabaseAdmin } from '@/lib/supabase';

export async function OPTIONS() { return corsPreflight(); }

/**
 * Action: Send a transactional email via Resend.
 * Body: {
 *   to: "lead@x.com",
 *   subject: "...",
 *   body_html?: "<p>...</p>",
 *   body_text?: "Plain text",   // converted to <p>...</p> if no body_html
 *   from_name?: "Custom Name",
 *   reply_to?: "you@yourdomain.com",
 *   cc?: ["one@x.com"], bcc?: ["two@x.com"]
 * }
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateApiV1(request);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as {
    to?: string;
    subject?: string;
    body_html?: string;
    body_text?: string;
    from_name?: string;
    reply_to?: string;
    cc?: string[];
    bcc?: string[];
  };

  const to = (body.to || '').trim();
  const subject = (body.subject || '').trim();
  const html = body.body_html || (body.body_text ? `<p>${escapeHtml(body.body_text).replace(/\n/g, '<br/>')}</p>` : '');
  if (!to || !subject || !html) {
    return NextResponse.json({ error: 'to_subject_and_body_required' }, { status: 400, headers: CORS_HEADERS });
  }

  // Use the venue's notification email for the visible "from name" if not specified
  let fromName = body.from_name?.trim() || '';
  if (!fromName) {
    const { data } = await supabaseAdmin
      .from('venues')
      .select('name')
      .eq('id', auth.venueId)
      .maybeSingle();
    fromName = ((data as { name?: string } | null)?.name) || 'StoryVenue';
  }

  const result = await sendEmail({
    to,
    subject,
    html,
    cc: body.cc,
    bcc: body.bcc,
    replyTo: body.reply_to,
    from: { name: fromName },
  });
  if (!result.success) {
    return NextResponse.json({ error: result.error || 'email_send_failed' }, { status: 502, headers: CORS_HEADERS });
  }
  return NextResponse.json({ success: true }, { headers: CORS_HEADERS });
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
