import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { cancelVenueSubscription } from '@/lib/venue-billing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!user.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    await cancelVenueSubscription(user.venueId);
    // Analytics: churn signal — venue cancels its subscription.
    void import('@/lib/analytics')
      .then(({ trackEvent }) => trackEvent({
        event: 'subscription_canceled', kind: 'auto', venueId: user.venueId,
        userEmail: user.memberEmail, role: user.role, label: 'Subscription canceled',
      }))
      .catch(() => { /* non-fatal */ });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Cancel failed';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
