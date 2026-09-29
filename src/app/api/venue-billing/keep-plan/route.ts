import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { keepVenuePlan } from '@/lib/venue-billing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/venue-billing/keep-plan
 *
 * "Keep my plan": undoes a pending cancel before its end date, so the plan
 * renews as normal and the venue doesn't move to Free.
 */
export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!user.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    await keepVenuePlan(user.venueId);
    void import('@/lib/analytics')
      .then(({ trackEvent }) => trackEvent({
        event: 'subscription_resumed', kind: 'auto', venueId: user.venueId,
        userEmail: user.memberEmail, role: user.role, label: 'Kept plan after canceling',
      }))
      .catch(() => { /* non-fatal */ });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not keep your plan';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
