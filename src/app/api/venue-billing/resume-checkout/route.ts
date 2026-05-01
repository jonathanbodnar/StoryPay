import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { resumePendingCheckout } from '@/lib/venue-billing';
import { isPlatformDirectoryBillingConfigured } from '@/lib/platform-directory-billing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/venue-billing/resume-checkout
 *
 * Re-creates a LunarPay checkout session for a venue that's stuck in `pending`
 * status (closed the tab mid-checkout, network blip, etc.). Returns the URL
 * the client should redirect to.
 */
export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!user.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (!isPlatformDirectoryBillingConfigured()) {
    return NextResponse.json(
      { error: 'Directory subscription billing is not configured on the server.' },
      { status: 503 },
    );
  }

  try {
    const { url } = await resumePendingCheckout(user.venueId);
    return NextResponse.json({ url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not resume checkout';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
