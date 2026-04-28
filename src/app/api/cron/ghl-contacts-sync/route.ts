import { NextRequest, NextResponse } from 'next/server';
import { syncAllGhlConnectedVenues } from '@/lib/ghl-contacts-sync';

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
 * Pulls fresh contacts from every GHL-connected venue.
 *
 * Defaults to a 6-hour staleness window — venues whose last sync is within
 * 6 h are skipped. Override via ?staleHours=24 if you want to force a wider
 * sweep.  Per-run venue cap is 25 to stay well within Railway's request
 * timeout; the long tail catches up on subsequent invocations.
 *
 * Schedule: every hour is plenty (contacts don't change rapidly). The
 * cron-service Start Command in Railway should curl
 *   /api/cron/ghl-contacts-sync?secret=$MARKETING_CRON_SECRET
 * once an hour.
 */
export async function GET(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const staleHours = Number(request.nextUrl.searchParams.get('staleHours') ?? '6');
  const maxVenues  = Number(request.nextUrl.searchParams.get('maxVenues')  ?? '25');

  try {
    const result = await syncAllGhlConnectedVenues({ staleHours, maxVenues });
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error('[cron ghl-contacts-sync]', err);
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}
