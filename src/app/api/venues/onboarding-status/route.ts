import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { agencyGetMerchant } from '@/lib/lunarpay';

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
    return NextResponse.json(
      { error: 'Venue not found or missing merchant account' },
      { status: 404 }
    );
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

    let status: string;
    if (isActive) {
      status = 'active';
    } else {
      const rawStatus =
        onboarding.status ||
        merchant.onboardingStatus ||
        merchant.status ||
        venue.onboarding_status ||
        'pending';
      status = rawStatus.toLowerCase().replace(/\s+/g, '_');
    }

    const allowedStatuses = ['pending', 'bank_information_sent', 'under_review', 'active'];
    if (!allowedStatuses.includes(status)) {
      // Normalize unknown statuses: if it was previously submitted, keep it as under_review
      status = venue.onboarding_status === 'pending' ? 'pending' : 'under_review';
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
