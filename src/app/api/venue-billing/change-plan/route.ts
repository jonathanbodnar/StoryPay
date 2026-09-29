import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { changeVenuePlan, scheduleVenueDowngradeToFree } from '@/lib/venue-billing';
import { loadBillingVenue, saasBillingConfiguredFor } from '@/lib/stripe/billing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Is the venue on a subscription that's billing it (a paid plan or a carded trial)? */
async function hasLiveSaasSubscription(venueId: string): Promise<boolean> {
  const v = await loadBillingVenue(venueId);
  return Boolean(
    v?.directory_subscription_external_id &&
      ['active', 'trialing'].includes(String(v.directory_subscription_status ?? '')),
  );
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!user.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: { plan_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const planId = body.plan_id?.trim();
  if (!planId) return NextResponse.json({ error: 'plan_id is required' }, { status: 400 });

  if (!(await saasBillingConfiguredFor(user.venueId))) {
    return NextResponse.json(
      { error: 'Directory subscription billing is not configured on the server.' },
      { status: 503 },
    );
  }

  try {
    // Switching a paid subscription to Free is a cancel: the plan stays on
    // until the end of the paid term (or trial), then the venue moves to Free.
    const { resolveFreePlan } = await import('@/lib/trial-plans');
    const freePlan = await resolveFreePlan();
    if (freePlan?.id === planId && (await hasLiveSaasSubscription(user.venueId))) {
      const result = await scheduleVenueDowngradeToFree(user.venueId);
      return NextResponse.json(
        result.kind === 'scheduled'
          ? { kind: 'scheduled', plan_id: planId, downgrade_at: result.downgradeAt }
          : { kind: 'switched', plan_id: planId },
      );
    }
    const result = await changeVenuePlan(user.venueId, planId);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Plan change failed';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
