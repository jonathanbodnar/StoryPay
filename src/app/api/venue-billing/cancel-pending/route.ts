import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { cancelPendingUpgrade } from '@/lib/venue-billing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/venue-billing/cancel-pending
 *
 * Aborts a pending plan upgrade. Clears the venue's directory_plan_id and
 * directory_subscription_status fields so they can re-select a plan or stay
 * on the free tier. No-op if the venue isn't currently in `pending` status.
 */
export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!user.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    await cancelPendingUpgrade(user.venueId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not cancel pending upgrade';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
