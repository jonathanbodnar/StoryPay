/**
 * Resend event webhook
 *
 * Setup in Resend dashboard → Webhooks → Add endpoint:
 *   URL:    https://app.storyvenue.com/api/webhooks/resend?secret=<RESEND_WEBHOOK_SECRET>
 *   Events: email.delivered, email.bounced, email.complained, email.opened, email.clicked
 *
 * MANUAL DASHBOARD STEP: `email.delivered` was NOT previously subscribed —
 * enable it in the Resend dashboard's webhook config alongside the existing
 * event types above, or delivery ticks in the support inbox will never
 * appear (opened/bounced already worked before this change).
 *
 * Required env var: RESEND_WEBHOOK_SECRET (any random string you generate)
 *
 * Handles:
 *   email.delivered  → sets delivery_status='delivered' + delivered_at on the
 *                       matching conversation_messages/support_thread_messages
 *                       row (matched via resend_email_id), for the support
 *                       inbox's sent→delivered→bounced status icon.
 *   email.bounced    → suppress address, disable marketing opt-in, AND sets
 *                       delivery_status='bounced' on the matching message row.
 *   email.complained → suppress address as spam complaint.
 *   email.opened     → apply email_opened system tag to matching lead, AND
 *                       sets opened_at on the matching message row (agent-only
 *                       "seen" signal — never shown to the customer).
 *   email.clicked    → apply email_clicked system tag to matching lead.
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

/**
 * Support-inbox delivery/read status: both conversation_messages (bride
 * replies + venue direct) and support_thread_messages (Venue Support
 * tickets) stamp `resend_email_id` on send (see sendAsVenue / ticket reply
 * route), so a single Resend event can be correlated to whichever table
 * actually sent it. Tries both — a given email_id only ever matches one.
 */
async function updateMessageDeliveryStatusByResendId(
  emailId: string,
  fields: { delivery_status?: string; delivered_at?: string; opened_at?: string; bounced_at?: string },
): Promise<void> {
  const { data: convoMatch } = await supabaseAdmin
    .from('conversation_messages')
    .update(fields)
    .eq('resend_email_id', emailId)
    .select('id')
    .maybeSingle();
  if (convoMatch) return;

  await supabaseAdmin
    .from('support_thread_messages')
    .update(fields)
    .eq('resend_email_id', emailId)
    .select('id')
    .maybeSingle();
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
  const emailId = data?.email_id;

  // Pull correlation IDs we stamped on send (X-Venue-Id, X-Lead-Id).
  const venueId = getHeader(emailHeaders, 'X-Venue-Id');
  const leadId = getHeader(emailHeaders, 'X-Lead-Id');

  console.log(`[webhooks/resend] event=${type} to=${recipient} venueId=${venueId ?? 'unknown'} leadId=${leadId ?? 'unknown'}`);

  if (type === 'email.delivered') {
    if (emailId) {
      await updateMessageDeliveryStatusByResendId(emailId, {
        delivery_status: 'delivered',
        delivered_at: new Date().toISOString(),
      });
    }
    return NextResponse.json({ ok: true });
  }

  if (type === 'email.bounced') {
    // Hard bounces mean the address does not exist or is permanently unreachable.
    // Suppress immediately to protect sender reputation.
    if (recipient) {
      await suppressByEmail(recipient, 'bounce', venueId, leadId);
      console.log(`[webhooks/resend] suppressed bounce: ${recipient}`);
    }
    if (emailId) {
      await updateMessageDeliveryStatusByResendId(emailId, {
        delivery_status: 'bounced',
        bounced_at: new Date().toISOString(),
      });
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
    if (type === 'email.opened' && emailId) {
      await updateMessageDeliveryStatusByResendId(emailId, { opened_at: new Date().toISOString() });
    }
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
