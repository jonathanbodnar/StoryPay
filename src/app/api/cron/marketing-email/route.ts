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
 * Kill switch for the marketing email processor.
 *
 * Default behavior after this commit: DISABLED. The cron can keep hitting
 * Railway's scheduled URL without actually sending campaigns or advancing
 * automation steps — the endpoint just returns `{ ok: true, disabled: true }`.
 *
 * To re-enable, set MARKETING_CRON_ENABLED=1 (or "true"/"yes"/"on") in the
 * Railway service env. No redeploy required.
 *
 * (MARKETING_CRON_DISABLED=1 is also honored as an explicit "off" signal so
 * we don't regress anyone who already set it from the earlier kill-switch
 * patch.)
 */
function cronEnabled(): boolean {
  const off = (process.env.MARKETING_CRON_DISABLED || '').trim().toLowerCase();
  if (off === '1' || off === 'true' || off === 'yes' || off === 'on') return false;
  const on = (process.env.MARKETING_CRON_ENABLED || '').trim().toLowerCase();
  return on === '1' || on === 'true' || on === 'yes' || on === 'on';
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
      hint: 'Set MARKETING_CRON_ENABLED=1 to resume sending.',
      result: null,
    });
  }
  try {
    const result = await runMarketingEmailCron();
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    console.error('[cron marketing-email]', e);
    return NextResponse.json({ error: 'Processor failed' }, { status: 500 });
  }
}
