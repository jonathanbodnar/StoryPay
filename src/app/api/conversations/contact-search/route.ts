import { NextRequest, NextResponse } from 'next/server';
import { getVenueId } from '@/lib/auth-helpers';
import {
  ensureVenueCustomerIdForMergedContact,
  mergeVenueContacts,
} from '@/lib/merge-venue-contacts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Same people as /api/customers (GHL + LunarPay + venue_customers), but each result
 * includes a StoryVenue `venue_customers.id` for starting a conversation thread.
 */
export async function GET(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const search = request.nextUrl.searchParams.get('search')?.trim() ?? '';
  if (!search) return NextResponse.json([]);

  const { data: merged } = await mergeVenueContacts(venueId, { search, page: 1, limit: 40 });
  const out: { id: string; first_name: string; last_name: string; customer_email: string }[] = [];
  const seen = new Set<string>();

  const candidates = merged.slice(0, 24);
  const vids = await Promise.all(
    candidates.map((c) => ensureVenueCustomerIdForMergedContact(venueId, c))
  );

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const vid = vids[i];
    if (!vid || seen.has(vid)) continue;
    seen.add(vid);
    out.push({
      id: vid,
      first_name: c.firstName,
      last_name: c.lastName,
      customer_email: c.email || '',
    });
    if (out.length >= 20) break;
  }

  return NextResponse.json(out);
}
