import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { scheduleVenueDowngradeToFree } from '@/lib/venue-billing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/venue-billing/cancel
 *
 * The venue cancels its paid plan. No future charge fires, the plan stays on
 * until the end of the term they paid for (or their trial), then they move to
 * the Free plan and stay on the platform (lib/venue-billing.ts).
 */
export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!user.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const result = await scheduleVenueDowngradeToFree(user.venueId);
    // Analytics: churn signal — venue cancels its subscription.
    void import('@/lib/analytics')
      .then(({ trackEvent }) => trackEvent({
        event: 'subscription_canceled', kind: 'auto', venueId: user.venueId,
        userEmail: user.memberEmail, role: user.role, label: 'Subscription canceled',
        properties: { type: 'cancel', outcome: result.kind },
      }))
      .catch(() => { /* non-fatal */ });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Cancel failed';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
