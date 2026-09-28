import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { createSaasBillingLink } from '@/lib/stripe/billing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Generate a payment link for a venue's subscription (ops: send link to customer). Stripe once it's on. */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await verifyAdminCookie())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: venueId } = await params;
  if (!venueId) {
    return NextResponse.json({ error: 'Missing venue id' }, { status: 400 });
  }

  try {
    const { url, provider } = await createSaasBillingLink(venueId);
    return NextResponse.json({ url, provider });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
