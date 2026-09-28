import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { retrySubscriptionCharge } from '@/lib/venue-billing';
import { createCardUpdateCheckout, loadBillingVenue } from '@/lib/stripe/billing';
import { isStripeConfigured, stripeBillingEnabledFor } from '@/lib/stripe/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Translate a raw LunarPay/gateway error into a friendly, human-readable
 * message for the venue owner. Falls back to a generic message so we never
 * surface raw API JSON like `LunarPay API error 402: {"error":"..."}`.
 */
function friendlyChargeError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes('insufficient')) {
    return 'Your card has insufficient funds. Please try a different card.';
  }
  if (lower.includes('expired')) {
    return 'Your card has expired. Please update your payment method.';
  }
  if (lower.includes('incorrect') || lower.includes('cvc') || lower.includes('cvv')) {
    return 'Your card details were incorrect. Please update your payment method.';
  }
  if (lower.includes('decline') || lower.includes('402')) {
    return 'Your card was declined. Please try a different card.';
  }
  return "We couldn't process the payment. Please try again or use a different card.";
}

export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!user.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // A venue still on LunarPay pays by adding a card on Stripe, which moves its
  // billing over; the old LunarPay card is never retried once Stripe is on.
  try {
    const bv = await loadBillingVenue(user.venueId);
    if (bv?.billing_provider === 'lunarpay' && isStripeConfigured() && stripeBillingEnabledFor(bv)) {
      const { url } = await createCardUpdateCheckout(user.venueId, '/dashboard/directory-billing', 'lp_move');
      return NextResponse.json({ url });
    }
  } catch (e) {
    console.error('[venue-billing/retry] Stripe card page failed:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Could not open the card page. Please try again.' }, { status: 500 });
  }

  try {
    await retrySubscriptionCharge(user.venueId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const raw = e instanceof Error ? e.message : 'Retry failed';
    // Log the raw gateway error for debugging; return a friendly message.
    console.error('[venue-billing/retry] charge failed:', raw);
    return NextResponse.json({ error: friendlyChargeError(raw) }, { status: 400 });
  }
}
