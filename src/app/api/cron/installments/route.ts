/**
 * GET /api/cron/installments  (Bearer MARKETING_CRON_SECRET / CRON_SECRET)
 *
 * Runs the payment-plan job (lib/stripe/installments-cron.ts) on demand. The
 * in-app scheduler runs it hourly; the GitHub workflow is a backup until the
 * repo goes private. Overlapping runs never charge twice.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isStripeConfigured } from '@/lib/stripe/client';
import { runInstallmentsCron } from '@/lib/stripe/installments-cron';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function authorize(request: NextRequest): boolean {
  const secret = process.env.MARKETING_CRON_SECRET || process.env.CRON_SECRET || '';
  if (!secret) return process.env.NODE_ENV !== 'production';
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  return token === secret || request.nextUrl.searchParams.get('secret') === secret;
}

export async function GET(request: NextRequest) {
  if (!authorize(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isStripeConfigured()) return NextResponse.json({ ok: true, result: { skipped: 'stripe not configured' } });

  try {
    return NextResponse.json({ ok: true, result: await runInstallmentsCron() });
  } catch (e) {
    console.error('[cron/installments]', e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
