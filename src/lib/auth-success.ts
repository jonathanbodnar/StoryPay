import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * Shared post-authentication logic used by both the password sign-in path
 * and the 2FA verify path. Computes the correct redirect (plan-gate or
 * dashboard), sets the venue_id cookie, and returns the response.
 */
export async function buildVenueAuthSuccessResponse(opts: {
  venueId:     string;
  rememberMe:  boolean;
  /** Optional pre-fetched fields to avoid an extra DB roundtrip. */
  prefetched?: {
    directory_plan_id:             string | null;
    directory_subscription_status: string | null;
  };
}): Promise<NextResponse> {
  const maxAge = opts.rememberMe ? 60 * 60 * 24 * 365 : 60 * 60 * 24 * 30;

  let planId: string | null;
  let subStatus: string;

  if (opts.prefetched) {
    planId    = opts.prefetched.directory_plan_id ?? null;
    subStatus = String(opts.prefetched.directory_subscription_status ?? 'none');
  } else {
    const { data } = await supabaseAdmin
      .from('venues')
      .select('directory_plan_id, directory_subscription_status')
      .eq('id', opts.venueId)
      .maybeSingle();
    planId    = (data?.directory_plan_id as string | null) ?? null;
    subStatus = String(data?.directory_subscription_status ?? 'none');
  }

  let isLegacy = false;
  if (planId) {
    const { data: planRow } = await supabaseAdmin
      .from('directory_plans')
      .select('is_legacy, name, slug')
      .eq('id', planId)
      .maybeSingle();
    const p = planRow as { is_legacy?: boolean; name?: string | null; slug?: string | null } | null;
    isLegacy =
      p?.is_legacy === true ||
      /legacy/i.test(p?.name ?? '') ||
      /legacy/i.test(p?.slug ?? '');
  }

  const needsPlan =
    !isLegacy && (!planId || subStatus === 'none' || subStatus === 'pending');
  const redirect = needsPlan ? '/signup/plan' : '/dashboard';

  const response = NextResponse.json({ redirect });
  response.cookies.set('venue_id', opts.venueId, {
    path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge,
  });
  return response;
}
