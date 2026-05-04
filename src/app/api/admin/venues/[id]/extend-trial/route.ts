import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { extendVenueTrial } from '@/lib/venue-billing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/admin/venues/[id]/extend-trial
 *
 * Body: { trial_ends_at: string }   — ISO date string (e.g. "2026-06-01") or
 *                                     ISO datetime. Must be in the future.
 *
 * Extends (or shortens) a venue's free trial AND syncs the LunarPay
 * subscription's `startOn` to the new date if the venue is currently
 * trialing with a scheduled LP sub. The existing sub is cancelled and a
 * replacement is created starting on the new date.
 *
 * Returns: { trialEndsAt: string; newSubId: string | null; lpSynced: boolean }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await verifyAdminCookie())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: venueId } = await params;
  if (!venueId) return NextResponse.json({ error: 'Missing venue id' }, { status: 400 });

  let body: { trial_ends_at?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { trial_ends_at } = body;
  if (!trial_ends_at || typeof trial_ends_at !== 'string') {
    return NextResponse.json({ error: 'trial_ends_at is required (ISO date string)' }, { status: 400 });
  }

  const newDate = new Date(trial_ends_at);
  if (Number.isNaN(newDate.getTime())) {
    return NextResponse.json({ error: 'trial_ends_at is not a valid date' }, { status: 400 });
  }
  if (newDate.getTime() <= Date.now()) {
    return NextResponse.json(
      { error: 'trial_ends_at must be in the future' },
      { status: 400 },
    );
  }

  try {
    const result = await extendVenueTrial(venueId, newDate);
    return NextResponse.json({
      trialEndsAt: result.trialEndsAt,
      newSubId:    result.newSubId,
      lpSynced:    result.newSubId !== null || result.trialEndsAt !== null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to extend trial';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
