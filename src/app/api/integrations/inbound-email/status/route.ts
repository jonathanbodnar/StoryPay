/**
 * GET /api/integrations/inbound-email/status
 *
 * Returns a per-piece diagnostic of the inbound-email pipeline so the
 * Settings UI can show exactly which step is missing when bride replies
 * aren't landing in the chat thread.
 *
 * Inbound email needs ALL of these to work end-to-end:
 *   1. RESEND_API_KEY                       — fetch parsed body via Resend API
 *   2. CONVERSATIONS_INBOUND_DOMAIN         — domain for the Reply-To address
 *   3. CONVERSATIONS_INBOUND_SECRET         — HMAC secret for signed tokens
 *   4. RESEND_WEBHOOK_SECRET (or token)     — verify Resend `email.received` POSTs
 *   5. DNS MX records on inbound domain     — must point to Resend's MX
 *   6. Resend "email.received" webhook      — configured to our /api/webhooks/inbound-email
 *
 * We can verify 1–4 from env vars and report on 5–6 (we'd need DNS / Resend
 * API access to truly check them, but we surface the URLs to verify).
 */

import { NextResponse } from 'next/server';
import { requireVenueId } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Check = { ok: boolean; label: string; detail: string };

function mask(v: string | undefined | null): string {
  if (!v) return '(unset)';
  const s = v.trim();
  if (s.length <= 8) return `${s.slice(0, 2)}…`;
  return `${s.slice(0, 4)}…${s.slice(-4)} (len=${s.length})`;
}

export async function GET() {
  try {
    await requireVenueId();
  } catch {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const resendKey = process.env.RESEND_API_KEY?.trim();
  const inboundDomain = process.env.CONVERSATIONS_INBOUND_DOMAIN?.trim();
  const inboundSecret = process.env.CONVERSATIONS_INBOUND_SECRET?.trim();
  const resendWebhookSecret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  const inboundEmailToken = process.env.INBOUND_EMAIL_WEBHOOK_TOKEN?.trim();
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.storypay.io').replace(/\/$/, '');

  const checks: Record<string, Check> = {
    resendApi: {
      ok: !!resendKey,
      label: 'Resend API key',
      detail: resendKey
        ? `RESEND_API_KEY is set (${mask(resendKey)})`
        : 'RESEND_API_KEY is not set in Railway — we need this to fetch the parsed body when a reply arrives.',
    },
    inboundDomain: {
      ok: !!inboundDomain,
      label: 'Inbound domain',
      detail: inboundDomain
        ? `CONVERSATIONS_INBOUND_DOMAIN=${inboundDomain}`
        : 'CONVERSATIONS_INBOUND_DOMAIN is not set. Without it, outbound emails are sent WITHOUT a tracked Reply-To address — bride replies go back to your brand email and are never imported into the chat thread.',
    },
    inboundSecret: {
      ok: !!inboundSecret,
      label: 'Inbound HMAC secret',
      detail: inboundSecret
        ? `CONVERSATIONS_INBOUND_SECRET is set (${mask(inboundSecret)})`
        : 'CONVERSATIONS_INBOUND_SECRET is not set. This secret signs the per-thread reply token so replies route back to the right thread.',
    },
    webhookAuth: {
      ok: !!(resendWebhookSecret || inboundEmailToken),
      label: 'Webhook signing secret',
      detail: resendWebhookSecret
        ? `RESEND_WEBHOOK_SECRET is set (${mask(resendWebhookSecret)}) — Resend's Svix signature is verified.`
        : inboundEmailToken
          ? `INBOUND_EMAIL_WEBHOOK_TOKEN is set (${mask(inboundEmailToken)}) — Resend must include ?token=... when calling our webhook.`
          : 'Neither RESEND_WEBHOOK_SECRET nor INBOUND_EMAIL_WEBHOOK_TOKEN is set. In production at least one MUST be configured or the webhook will reject all calls as Unauthorized.',
    },
  };

  const ready = Object.values(checks).every((c) => c.ok);
  const webhookUrl = `${appUrl}/api/webhooks/inbound-email`;

  return NextResponse.json({
    ready,
    webhookUrl,
    inboundDomain: inboundDomain || null,
    checks,
    nextSteps: ready
      ? [
          'All required env vars are present.',
          `Verify your inbound domain (${inboundDomain}) has MX records pointing to Resend (feedback-smtp.us-east-1.amazonses.com — see Resend → Domains → Inbound).`,
          `Verify the Resend "email.received" webhook is pointed at ${webhookUrl}.`,
        ]
      : [
          'Set the missing environment variables above in Railway.',
          'Restart the service so the new env vars take effect.',
          `Confirm DNS MX records and Resend webhook point to ${webhookUrl}.`,
        ],
  });
}
