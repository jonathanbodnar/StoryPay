/**
 * POST /api/lunarpay/onboard (retired)
 *
 * Used to submit the Fortis merchant application (business and banking
 * details). StoryPay™ now runs on Stripe, so new LunarPay applications are
 * closed. See lib/lunarpay-retired.ts.
 */
import { lunarPayRetiredResponse } from '@/lib/lunarpay-retired';

export const dynamic = 'force-dynamic';

export async function POST() {
  return lunarPayRetiredResponse();
}
