/**
 * Super-admin: pull A2P 10DLC brand + campaign status from GHL for one venue
 * and cache it on the venue row.
 *
 * Behavior is in `lib/ai-concierge/a2p-verification.ts`. The endpoint is a
 * thin wrapper that:
 *   1. Verifies the admin cookie.
 *   2. Calls `refreshVenueA2pStatus(venueId)`.
 *   3. Returns the resulting snapshot for the UI to render.
 *
 * This route NEVER fails on a remote GHL error: the helper internally
 * persists the error string to `venues.a2p_last_check_error` and returns a
 * snapshot with `decision='fetch_failed'`. We surface that to the UI as a
 * 200 with `{ ok: true, snapshot: { decision: 'fetch_failed', ... } }` so
 * the operator sees the diagnostic without a scary modal.
 */

import { NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { refreshVenueA2pStatus } from '@/lib/ai-concierge/a2p-verification';

export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ venueId: string }> },
) {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { venueId } = await ctx.params;
  if (!venueId) return NextResponse.json({ error: 'Missing venueId' }, { status: 400 });

  try {
    const snapshot = await refreshVenueA2pStatus(venueId);
    return NextResponse.json({ ok: true, snapshot });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Venue not found/.test(msg)) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
