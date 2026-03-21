import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { agencyOnboardMerchant } from '@/lib/lunarpay';

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;

  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('lunarpay_merchant_id, onboarding_status')
    .eq('id', venueId)
    .single();

  if (!venue?.lunarpay_merchant_id) {
    return NextResponse.json(
      { error: 'Venue does not have a LunarPay merchant account' },
      { status: 400 }
    );
  }

  if (venue.onboarding_status && venue.onboarding_status !== 'pending') {
    return NextResponse.json(
      { error: 'Application has already been submitted' },
      { status: 409 }
    );
  }

  const body = await request.json();

  try {
    const result = await agencyOnboardMerchant(venue.lunarpay_merchant_id, body);
    const data = result.data || result;

    await supabaseAdmin
      .from('venues')
      .update({
        onboarding_status: (data.status || 'bank_information_sent').toLowerCase(),
        onboarding_mpa_url: data.mpaEmbedUrl || data.mpaLink || null,
      })
      .eq('id', venueId);

    return NextResponse.json({
      status: (data.status || 'bank_information_sent').toLowerCase(),
      mpaEmbedUrl: data.mpaEmbedUrl || null,
      mpaLink: data.mpaLink || null,
      message: data.message || 'Onboarding submitted',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Onboarding submission failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
