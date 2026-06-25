import { NextRequest, NextResponse } from 'next/server';
import { processTrialSweep } from '@/lib/trial-sweep';

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
 * Scheduled job: send trial-ending reminders and honor explicit user-chosen
 * deferred downgrades to Free. Never auto-downgrades a trial — carded trials
 * are auto-charged by LunarPay at period end. Run a few times per day.
 */
export async function GET(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await processTrialSweep();
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    console.error('[cron trial-sweep]', e);
    return NextResponse.json({ error: 'Processor failed' }, { status: 500 });
  }
}
