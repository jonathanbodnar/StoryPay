import { NextRequest, NextResponse } from 'next/server';
import { runMarketingEmailCron } from '@/lib/marketing-email-worker';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function cronSecret(): string {
  return process.env.MARKETING_CRON_SECRET || process.env.CRON_SECRET || '';
}

function authorize(request: NextRequest): boolean {
  const secret = cronSecret();
  if (!secret) return process.env.NODE_ENV !== 'production';
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (token === secret) return true;
  const q = request.nextUrl.searchParams.get('secret');
  return !!q && q === secret;
}

/**
 * The marketing cron is ENABLED by default.
 * Set MARKETING_CRON_DISABLED=1 in Railway to pause all campaign sending
 * and automation step advancement without a redeploy.
 */
function cronEnabled(): boolean {
  const off = (process.env.MARKETING_CRON_DISABLED || '').trim().toLowerCase();
  return !(off === '1' || off === 'true' || off === 'yes' || off === 'on');
}

/**
 * Ping this same cron endpoint after a short delay so that enrollments
 * waiting on a delay step are picked up automatically without an external
 * scheduler.  We call this after every run that had work to do, up to a
 * configurable reschedule interval (default 60 s).
 */
function selfPingAfter(delayMs: number) {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com').replace(/\/$/, '');
  const secret = cronSecret();
  const url = `${appUrl}/api/cron/marketing-email${secret ? `?secret=${encodeURIComponent(secret)}` : ''}`;
  setTimeout(() => {
    fetch(url, { method: 'GET' }).catch(() => {/* fire-and-forget */});
  }, delayMs);
}

/** Scheduled HTTP job (e.g. Railway Cron, GitHub Actions, curl): campaigns + automation steps. */
export async function GET(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!cronEnabled()) {
    return NextResponse.json({
      ok: true,
      disabled: true,
      hint: 'Set MARKETING_CRON_DISABLED=1 to pause.',
      result: null,
    });
  }
  try {
    const result = await runMarketingEmailCron();
    // If any automation steps ran, self-ping after 60 s so delay steps advance
    // without needing an external cron service configured on Railway.
    const hadWork =
      (result.automationSteps as number) > 0 ||
      (result.campaignRecipientsSent as number) > 0 ||
      (result.weddingFollowupEnrollments as number) > 0;
    if (hadWork) selfPingAfter(60_000);
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    console.error('[cron marketing-email]', e);
    return NextResponse.json({ error: 'Processor failed' }, { status: 500 });
  }
}
