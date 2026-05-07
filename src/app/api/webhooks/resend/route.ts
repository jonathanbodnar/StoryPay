/**
 * Resend bounce + complaint webhook
 *
 * Setup in Resend dashboard → Webhooks → Add endpoint:
 *   URL:    https://app.storyvenue.com/api/webhooks/resend?secret=<RESEND_WEBHOOK_SECRET>
 *   Events: email.bounced, email.complained
 *
 * Required env var: RESEND_WEBHOOK_SECRET (any random string you generate)
 *
 * Why this matters: hard bounces and spam complaints from ANY venue using the
 * shared storyvenue.com sending domain hurt our aggregate reputation with
 * Gmail/Yahoo. This handler auto-suppresses bad addresses immediately so the
 * next cron run skips them.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ResendWebhookPayload {
  type: string;
  data: {
    email_id?: string;
    from?: string;
    to?: string[];
    subject?: string;
    created_at?: string;
    bounce?: { message?: string };
    headers?: Array<{ name: string; value: string }>;
  };
}

function getHeader(headers: Array<{ name: string; value: string }> | undefined, name: string): string | undefined {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

async function suppressByEmail(
  recipientEmail: string,
  reason: string,
  venueId?: string,
  leadId?: string,
): Promise<void> {
  const email = recipientEmail.trim().toLowerCase();
  if (!email || !email.includes('@')) return;

  if (venueId && leadId) {
    // Fast path: we have exact identifiers from X-Venue-Id / X-Lead-Id headers.
    await supabaseAdmin.from('marketing_email_suppressions').upsert(
      { lead_id: leadId, venue_id: venueId, reason },
      { onConflict: 'lead_id,venue_id' },
    );
    if (reason === 'bounce') {
      await supabaseAdmin
        .from('leads')
        .update({ marketing_email_opt_in: false })
        .eq('id', leadId)
        .eq('venue_id', venueId);
    }
    return;
  }

  // Fallback: look up all leads with this email address and suppress across venues.
  const { data: leads } = await supabaseAdmin
    .from('leads')
    .select('id, venue_id')
    .ilike('email', email)
    .limit(50);

  if (!leads?.length) return;

  const rows = leads.map((l) => ({
    lead_id: l.id as string,
    venue_id: l.venue_id as string,
    reason,
  }));

  await supabaseAdmin
    .from('marketing_email_suppressions')
    .upsert(rows, { onConflict: 'lead_id,venue_id' });

  if (reason === 'bounce') {
    for (const l of leads) {
      await supabaseAdmin
        .from('leads')
        .update({ marketing_email_opt_in: false })
        .eq('id', l.id as string)
        .eq('venue_id', l.venue_id as string);
    }
  }
}

export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.error('[webhooks/resend] RESEND_WEBHOOK_SECRET is not set');
    return new NextResponse('Webhook not configured', { status: 500 });
  }

  const provided = request.nextUrl.searchParams.get('secret')?.trim();
  if (!provided || provided !== secret) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  let payload: ResendWebhookPayload;
  try {
    payload = (await request.json()) as ResendWebhookPayload;
  } catch {
    return new NextResponse('Bad request', { status: 400 });
  }

  const { type, data } = payload;
  const recipient = data?.to?.[0]?.trim() ?? '';
  const emailHeaders = data?.headers;

  // Pull correlation IDs we stamped on send (X-Venue-Id, X-Lead-Id).
  const venueId = getHeader(emailHeaders, 'X-Venue-Id');
  const leadId = getHeader(emailHeaders, 'X-Lead-Id');

  console.log(`[webhooks/resend] event=${type} to=${recipient} venueId=${venueId ?? 'unknown'} leadId=${leadId ?? 'unknown'}`);

  if (type === 'email.bounced') {
    // Hard bounces mean the address does not exist or is permanently unreachable.
    // Suppress immediately to protect sender reputation.
    if (recipient) {
      await suppressByEmail(recipient, 'bounce', venueId, leadId);
      console.log(`[webhooks/resend] suppressed bounce: ${recipient}`);
    }
    return NextResponse.json({ ok: true });
  }

  if (type === 'email.complained') {
    // Spam complaints are the most damaging signal to shared-domain reputation.
    // Suppress + opt out immediately.
    if (recipient) {
      await suppressByEmail(recipient, 'spam_complaint', venueId, leadId);
      console.log(`[webhooks/resend] suppressed complaint: ${recipient}`);
    }
    return NextResponse.json({ ok: true });
  }

  // Unknown event type — acknowledge so Resend doesn't retry.
  return NextResponse.json({ ok: true, ignored: type });
}
