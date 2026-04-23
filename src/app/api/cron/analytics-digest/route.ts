import { NextRequest, NextResponse } from 'next/server';
import { runAnalyticsDigestForAllVenues, sendAnalyticsDigest } from '@/lib/analytics-digest';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function authorize(request: NextRequest): boolean {
  const secret = process.env.MARKETING_CRON_SECRET || process.env.CRON_SECRET || '';
  if (!secret) return process.env.NODE_ENV !== 'production';
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (token === secret) return true;
  return request.nextUrl.searchParams.get('secret') === secret;
}

/** Weekly analytics digest — sends to all published venues.
 *  Can also target a single venue: ?venue_id=<uuid>
 */
export async function GET(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const venueId = request.nextUrl.searchParams.get('venue_id');

  if (venueId) {
    const result = await sendAnalyticsDigest(venueId);
    return NextResponse.json({ ok: result.ok, reason: result.reason ?? null });
  }

  const result = await runAnalyticsDigestForAllVenues();
  return NextResponse.json({ ok: true, ...result });
}
