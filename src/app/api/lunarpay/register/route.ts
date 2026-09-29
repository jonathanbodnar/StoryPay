/**
 * POST /api/lunarpay/register (retired)
 *
 * Used to register the venue as a LunarPay sub-merchant. StoryPay™ now runs on
 * Stripe (Payment settings → Connect with Stripe), so new LunarPay applications
 * are closed. See lib/lunarpay-retired.ts.
 */
import { lunarPayRetiredResponse } from '@/lib/lunarpay-retired';

export const dynamic = 'force-dynamic';

export async function POST() {
  return lunarPayRetiredResponse();
}
