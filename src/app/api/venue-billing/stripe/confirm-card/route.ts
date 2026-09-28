/**
 * POST /api/venue-billing/stripe/confirm-card
 * Body: { setupIntentId: string; plan: 'pro' | 'free' }
 *
 * The Stripe card form in the onboarding modal succeeded. Pro: start the
 * subscription with its first charge at the trial end. Free: card on file,
 * no subscription. Same venue writes as the LunarPay signup-checkout/confirm
 * and confirm-free routes.
 */
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { confirmCardAndStart, isStripeBillingVenue } from '@/lib/stripe/billing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { setupIntentId?: string; plan?: string };
  const setupIntentId = String(body.setupIntentId ?? '').trim();
  if (!setupIntentId.startsWith('seti_')) {
    return NextResponse.json({ error: 'setupIntentId is required' }, { status: 400 });
  }
  const plan = body.plan === 'free' ? 'free' : 'pro';

  if (!(await isStripeBillingVenue(venueId))) {
    return NextResponse.json({ error: 'This venue is not billed on Stripe.' }, { status: 409 });
  }
  try {
    const result = await confirmCardAndStart(venueId, setupIntentId, plan);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[stripe/confirm-card]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not finish setting up your card. Please try again.' },
      { status: 500 },
    );
  }
}
