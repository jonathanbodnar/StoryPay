/**
 * Idempotent helper to provision a LunarPay sub-merchant for a venue.
 *
 * Used by:
 *  - /api/auth/verify-email/<token>  (post-email-verification)
 *  - /api/lunarpay/register          (manual application form)
 *  - /api/admin/venues               (admin-triggered re-provisioning)
 *
 * Idempotency: if the venue already has lunarpay_merchant_id set, this
 * function returns successfully without re-calling LunarPay.
 *
 * Best-effort: on agency-API failure we log and return { ok: false }.
 * The caller decides whether to surface the error to the user.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { agencyCreateMerchant } from '@/lib/lunarpay';

interface OnboardArgs {
  venueId:      string;
  email:        string;
  firstName:    string;
  lastName:     string;
  phone:        string | null;
  businessName: string;
}

interface OnboardResult {
  ok:          boolean;
  alreadyDone: boolean;
  merchantId?: number | string | null;
  error?:      string;
}

export async function provisionVenueLunarPayMerchant(args: OnboardArgs): Promise<OnboardResult> {
  if (!process.env.LP_AGENCY_KEY && !process.env.LUNARPAY_AGENCY_KEY) {
    return { ok: false, alreadyDone: false, error: 'LP_AGENCY_KEY not configured' };
  }

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id, lunarpay_merchant_id')
    .eq('id', args.venueId)
    .maybeSingle();

  if (!venue) return { ok: false, alreadyDone: false, error: 'Venue not found' };
  if (venue.lunarpay_merchant_id) {
    return { ok: true, alreadyDone: true, merchantId: venue.lunarpay_merchant_id };
  }

  try {
    // Random throwaway password — LunarPay requires one for the agency
    // create call, but the venue never sees or uses it (they auth into
    // LunarPay via the orgToken).
    const lpResult = await agencyCreateMerchant({
      email:        args.email,
      password:     `SP-${Math.random().toString(36).slice(2, 14)}!`,
      firstName:    args.firstName,
      lastName:     args.lastName,
      phone:        args.phone ?? '',
      businessName: args.businessName,
    });

    const merchant = (lpResult as { data?: Record<string, unknown> }).data
      || (lpResult as Record<string, unknown>);

    const onboardStatus = String(
      (merchant.onboardingStatus as string | undefined) ?? 'pending',
    ).toLowerCase();

    await supabaseAdmin
      .from('venues')
      .update({
        lunarpay_merchant_id:     (merchant.merchantId as number | string) ?? null,
        lunarpay_organization_id: (merchant.organizationId as number | string) ?? null,
        lunarpay_secret_key:      (merchant.secretKey as string) ?? null,
        lunarpay_publishable_key: (merchant.publishableKey as string) ?? null,
        lunarpay_org_token:       (merchant.orgToken as string) ?? null,
        onboarding_status:        onboardStatus,
      })
      .eq('id', args.venueId);

    return {
      ok: true,
      alreadyDone: false,
      merchantId: (merchant.merchantId as number | string) ?? null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown LunarPay error';
    console.error('[provisionVenueLunarPayMerchant]', msg);
    return { ok: false, alreadyDone: false, error: msg };
  }
}
