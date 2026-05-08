/**
 * Resend event webhook
 *
 * Setup in Resend dashboard → Webhooks → Add endpoint:
 *   URL:    https://app.storyvenue.com/api/webhooks/resend?secret=<RESEND_WEBHOOK_SECRET>
 *   Events: email.bounced, email.complained, email.opened, email.clicked
 *
 * Required env var: RESEND_WEBHOOK_SECRET (any random string you generate)
 *
 * Handles:
 *   email.bounced    → suppress address, disable marketing opt-in
 *   email.complained → suppress address as spam complaint
 *   email.opened     → apply email_opened system tag to matching lead
 *   email.clicked    → apply email_clicked system tag to matching lead
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

  if (type === 'email.opened' || type === 'email.clicked') {
    const tagKey = type === 'email.opened' ? 'email_opened' : 'email_clicked';
    if (venueId && leadId) {
      // Fast path: headers carry the exact venue + lead
      const { applySystemTag, ensureSystemTagsForVenue } = await import('@/lib/system-tags');
      ensureSystemTagsForVenue(venueId)
        .then(() => applySystemTag(venueId, leadId, tagKey))
        .catch(() => {});
    } else if (recipient) {
      // Fallback: look up lead by email across all venues
      const { data: leads } = await supabaseAdmin
        .from('leads')
        .select('id, venue_id')
        .ilike('email', recipient.toLowerCase())
        .limit(10);
      if (leads?.length) {
        const { applySystemTag, ensureSystemTagsForVenue } = await import('@/lib/system-tags');
        for (const l of leads) {
          ensureSystemTagsForVenue(l.venue_id as string)
            .then(() => applySystemTag(l.venue_id as string, l.id as string, tagKey))
            .catch(() => {});
        }
      }
    }
    console.log(`[webhooks/resend] ${tagKey} applied for ${recipient}`);
    return NextResponse.json({ ok: true });
  }

  // Unknown event type — acknowledge so Resend doesn't retry.
  return NextResponse.json({ ok: true, ignored: type });
}
