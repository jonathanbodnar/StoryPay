/**
 * POST /api/proposals/public/[token]/checkout (retired)
 *
 * Used to open a LunarPay-hosted checkout for a proposal. Couples now pay
 * through Stripe (payment-intent + stripe-pay), so this never takes a payment.
 * See lib/lunarpay-retired.ts.
 */
import { LUNARPAY_PAYMENT_RETIRED_MESSAGE, lunarPayRetiredResponse } from '@/lib/lunarpay-retired';

export const dynamic = 'force-dynamic';

export async function POST() {
  return lunarPayRetiredResponse(LUNARPAY_PAYMENT_RETIRED_MESSAGE);
}
