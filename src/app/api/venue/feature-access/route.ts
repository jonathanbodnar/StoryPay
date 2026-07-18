/**
 * GET /api/venue/feature-access
 *
 * Returns the current venue's SMS + Concierge access flags so client
 * components can render lock states without duplicating plan logic.
 */

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { loadVenueFeatureAccess } from '@/lib/plan-features';

export const dynamic = 'force-dynamic';

export async function GET() {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const access = await loadVenueFeatureAccess(venueId);
  return NextResponse.json(access);
}
