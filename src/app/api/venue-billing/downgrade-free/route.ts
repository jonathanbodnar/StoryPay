import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { scheduleVenueDowngradeToFree } from '@/lib/venue-billing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/venue-billing/downgrade-free
 *
 * Owner-initiated switch to the Free plan. In the card-gated trial model this
 * cancels the paid subscription (so no future charge fires) but KEEPS access
 * until the end of the current trial/period, then drops to Free via the
 * trial-sweep cron. If there's no remaining period, it downgrades immediately.
 *
 * The Free plan keeps the directory listing + payment processing on; the
 * automated Bride Booking System switches off.
 */
export async function POST() {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const result = await scheduleVenueDowngradeToFree(venueId);
    // Analytics: churn signal — venue chose to leave the paid plan.
    void import('@/lib/analytics')
      .then(({ trackEvent }) => trackEvent({
        event: 'subscription_canceled', kind: 'auto', venueId, label: 'Downgraded to Free',
        properties: { type: 'downgrade_free', outcome: result.kind },
      }))
      .catch(() => { /* non-fatal */ });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not downgrade to Free';
    console.error('[downgrade-free] failed:', msg);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
