/**
 * Super-admin diagnostic: probe GHL's A2P endpoints for one venue without
 * touching any DB columns. Returns each attempted URL, status, body preview,
 * and parsed A2P fields (if any).
 *
 * Use this to debug:
 *   - "Why doesn't my A2P refresh detect the verified brand?"
 *   - "Which GHL endpoint shape does this plan tier expose?"
 *   - "Is the location-token being accepted at all?"
 *
 * The operator can compare bestExtracted against what GHL's UI shows to
 * determine whether our normalizer is missing a status string, or if GHL
 * itself isn't returning the expected fields.
 */

import { NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { diagnoseVenueA2pStatus } from '@/lib/ai-concierge/a2p-verification';

export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ venueId: string }> },
) {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { venueId } = await ctx.params;
  if (!venueId) return NextResponse.json({ error: 'Missing venueId' }, { status: 400 });

  try {
    const report = await diagnoseVenueA2pStatus(venueId);
    return NextResponse.json({ ok: true, report });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Venue not found/.test(msg)) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
