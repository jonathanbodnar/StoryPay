import { NextResponse } from 'next/server';

/**
 * LunarPay (the old payment processor) is retired. StoryPay™ runs on Stripe.
 *
 * Nobody can apply for a LunarPay merchant account any more, no couple
 * payment goes through LunarPay, and StoryVenue no longer copies customers or
 * products into it. Venues with a LunarPay account on file (White Pine
 * Manor's, plus unfinished applications) keep the record, unused. They take
 * payments by connecting Stripe like every other venue.
 *
 * What still talks to LunarPay until it's removed:
 *   • SaaS billing for the few subscribers not yet on Stripe
 *     (lib/platform-directory-billing.ts, lib/venue-billing.ts). They move to
 *     Stripe when they add a card.
 *   • Read-only lookups of old records: contacts, past transactions, and
 *     refunds of past LunarPay payments.
 */

export const LUNARPAY_RETIRED_MESSAGE =
  'StoryPay™ now runs on Stripe. Set up payments in Payments → Payment settings.';

/** Couple-facing: a payment link that would have gone through LunarPay. */
export const LUNARPAY_PAYMENT_RETIRED_MESSAGE =
  'Online payment isn’t set up for this venue yet. Please contact the venue to pay.';

/** A LunarPay billing route called for a venue whose subscription is on Stripe. */
export const SAAS_ON_STRIPE_MESSAGE =
  'Your StoryVenue billing now runs on Stripe. Please refresh the page and try again.';

/** The response for a retired LunarPay route (410 Gone). */
export function lunarPayRetiredResponse(message: string = LUNARPAY_RETIRED_MESSAGE) {
  return NextResponse.json({ error: message, retired: true }, { status: 410 });
}
