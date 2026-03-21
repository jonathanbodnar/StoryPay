import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getOnboardingStatus } from '@/lib/lunarpay';

export async function GET() {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;

  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: venue, error: venueError } = await supabaseAdmin
    .from('venues')
    .select('lunarpay_secret_key')
    .eq('id', venueId)
    .single();

  if (venueError || !venue?.lunarpay_secret_key) {
    return NextResponse.json(
      { error: 'Venue not found or missing LunarPay key' },
      { status: 404 }
    );
  }

  try {
    const status = await getOnboardingStatus(venue.lunarpay_secret_key);

    await supabaseAdmin
      .from('venues')
      .update({
        onboarding_status: status.status,
        onboarding_mpa_url: status.mpaEmbedUrl || null,
      })
      .eq('id', venueId);

    return NextResponse.json(status);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch onboarding status';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
