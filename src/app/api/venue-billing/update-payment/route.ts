import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import {
  startUpdatePaymentMethodCheckout,
  verifyUpdatePaymentMethod,
} from '@/lib/venue-billing';
import { createCardUpdateCheckout, loadBillingVenue, saasBillingConfiguredFor } from '@/lib/stripe/billing';
import { isStripeConfigured, stripeBillingEnabledFor } from '@/lib/stripe/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!user.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (!(await saasBillingConfiguredFor(user.venueId))) {
    return NextResponse.json(
      { error: 'Directory subscription billing is not configured on the server.' },
      { status: 503 },
    );
  }

  let body: { session_id?: string } = {};
  try {
    body = await request.json();
  } catch {
    // Allow empty body to mean "start update flow".
  }

  if (body.session_id && body.session_id.trim().length > 0) {
    try {
      await verifyUpdatePaymentMethod(user.venueId, body.session_id.trim());
      return NextResponse.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Verification failed';
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  }

  // A venue still on LunarPay updates its card on Stripe instead, which moves
  // its billing over (first Stripe charge on the next LunarPay date; an overdue
  // payment is charged right away).
  try {
    const bv = await loadBillingVenue(user.venueId);
    if (bv?.billing_provider === 'lunarpay' && isStripeConfigured() && stripeBillingEnabledFor(bv.slug)) {
      const { url } = await createCardUpdateCheckout(user.venueId, '/dashboard/directory-billing', 'lp_move');
      return NextResponse.json({ url });
    }
  } catch (e) {
    console.warn('[update-payment] Stripe move unavailable, using LunarPay:', e instanceof Error ? e.message : e);
  }

  try {
    const { url } = await startUpdatePaymentMethodCheckout(user.venueId);
    return NextResponse.json({ url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not start payment update';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
