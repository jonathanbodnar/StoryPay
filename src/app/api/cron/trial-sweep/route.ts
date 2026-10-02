import { NextRequest, NextResponse } from 'next/server';
import { applyDueFreeDowngrades, processNoCardTrials } from '@/lib/trial-sweep';
import { secureCompare } from '@/lib/secure-compare';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function authorize(request: NextRequest): boolean {
  const secret = process.env.MARKETING_CRON_SECRET || process.env.CRON_SECRET || '';
  if (!secret) return process.env.NODE_ENV !== 'production';
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const q = request.nextUrl.searchParams.get('secret') ?? '';
  return (!!token && secureCompare(token, secret)) || (!!q && secureCompare(q, secret));
}

/**
 * The trial and plan-end jobs, on demand: venues that cancelled move to Free
 * when the term they paid for ends, and trials without a card get their
 * heads-up, their end notice, then Free after the grace period. The in-app
 * scheduler runs the same two jobs (free-downgrades, no-card-trials); this
 * route lets the test copy, where that scheduler is off, run them too.
 * (Carded trials' reminders come from Stripe's trial_will_end notice.)
 */
export async function GET(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const downgrades = await applyDueFreeDowngrades();
    const noCard = await processNoCardTrials();
    return NextResponse.json({ ok: true, downgrades, noCard: { reminded: noCard.reminded, endedNotices: noCard.endedNotices, movedToFree: noCard.movedToFree, errors: noCard.errors } });
  } catch (e) {
    console.error('[cron trial-sweep]', e);
    return NextResponse.json({ error: 'Processor failed' }, { status: 500 });
  }
}
