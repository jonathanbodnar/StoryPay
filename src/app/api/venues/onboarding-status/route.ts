import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { agencyGetMerchant } from '@/lib/lunarpay';
import { normalizeLunarPayStatus, type LunarPayStatus as LunarPayCanonical } from '@/lib/lunarpay-status';

export async function GET() {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;

  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: venue, error: venueError } = await supabaseAdmin
    .from('venues')
    .select('lunarpay_merchant_id, onboarding_status, onboarding_mpa_url')
    .eq('id', venueId)
    .single();

  if (venueError || !venue?.lunarpay_merchant_id) {
    // No merchant on file yet — return the canonical "hasn't started" status
    // so the wizard shows the welcome screen instead of erroring. The previous
    // behaviour (404 "missing merchant account") made the venue think the
    // system was broken when in fact they just hadn't registered yet.
    return NextResponse.json({
      status: 'not_started',
      isActive: false,
    });
  }

  try {
    const result = await agencyGetMerchant(venue.lunarpay_merchant_id);
    const merchant = result.data || result;

    // LunarPay may nest onboarding data differently — check multiple paths
    const onboarding = merchant.onboarding || {};
    const isActive =
      onboarding.isActive === true ||
      merchant.isActive === true ||
      merchant.onboardingStatus === 'ACTIVE' ||
      onboarding.status === 'ACTIVE';

    // Use the venue's CURRENT persisted status as the normalization fallback
    // so a malformed / unrecognized LunarPay response can never regress the
    // owner backward through the wizard.
    const previousStatus = normalizeLunarPayStatus(
      venue.onboarding_status,
      venue.lunarpay_merchant_id ? 'registered' : 'not_started',
    );

    let status: LunarPayCanonical;
    if (isActive) {
      status = 'active';
    } else {
      const rawStatus =
        onboarding.status ||
        merchant.onboardingStatus ||
        merchant.status ||
        venue.onboarding_status ||
        'registered';
      status = normalizeLunarPayStatus(String(rawStatus), previousStatus);
    }

    const mpaUrl =
      onboarding.mpaEmbedUrl ||
      merchant.mpaEmbedUrl ||
      venue.onboarding_mpa_url ||
      null;

    await supabaseAdmin
      .from('venues')
      .update({
        onboarding_status: status,
        onboarding_mpa_url: mpaUrl,
      })
      .eq('id', venueId);

    console.log(`[onboarding-status] venue=${venueId} merchantId=${venue.lunarpay_merchant_id} status=${status} isActive=${isActive}`);

    return NextResponse.json({
      status,
      isActive,
      mpaEmbedUrl: mpaUrl,
      mpaLink: onboarding.mpaLink || merchant.mpaLink || null,
      stepCompleted: onboarding.stepCompleted || merchant.stepCompleted || null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch onboarding status';
    console.error(`[onboarding-status] error for venue=${venueId}:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
