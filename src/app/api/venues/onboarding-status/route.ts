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
    const onboarding = merchant.onboarding || merchant;

    const isActive = onboarding.isActive === true;
    const status = isActive
      ? 'active'
      : (onboarding.status || venue.onboarding_status || 'pending').toLowerCase();

    await supabaseAdmin
      .from('venues')
      .update({
        onboarding_status: status,
        onboarding_mpa_url: onboarding.mpaEmbedUrl || venue.onboarding_mpa_url || null,
      })
      .eq('id', venueId);

    return NextResponse.json({
      status,
      isActive,
      mpaEmbedUrl: onboarding.mpaEmbedUrl || venue.onboarding_mpa_url || null,
      mpaLink: onboarding.mpaLink || null,
      stepCompleted: onboarding.stepCompleted || null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch onboarding status';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
