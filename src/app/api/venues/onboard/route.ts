/**
 * POST /api/venues/onboard (retired)
 *
 * The original LunarPay merchant signup. StoryPay™ now runs on Stripe, so new
 * LunarPay applications are closed. See lib/lunarpay-retired.ts.
 */
import { lunarPayRetiredResponse } from '@/lib/lunarpay-retired';

export const dynamic = 'force-dynamic';

export async function POST() {
  return lunarPayRetiredResponse();
}
