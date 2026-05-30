import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { changeVenuePlan, listDirectoryPlanCatalog } from '@/lib/venue-billing';
import { resolveFreePlan } from '@/lib/trial-plans';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/venue-billing/downgrade-free
 *
 * Owner-initiated downgrade to the Free plan. Used by the post-trial wall when
 * a venue chooses not to add a card. Because the Free plan bills $0,
 * changeVenuePlan cancels any subscription on file and clears the
 * subscription status — no LunarPay subscription is created. Access then
 * reflects whatever the Free plan's feature checkboxes allow.
 */
export async function POST() {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const catalog = await listDirectoryPlanCatalog();
  const freePlan = await resolveFreePlan(catalog);
  if (!freePlan) {
    return NextResponse.json(
      { error: 'Free plan is not configured. Please contact support.' },
      { status: 500 },
    );
  }

  try {
    const result = await changeVenuePlan(venueId, freePlan.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not downgrade to Free';
    console.error('[downgrade-free] failed:', msg);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
