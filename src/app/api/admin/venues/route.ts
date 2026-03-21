import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { agencyCreateMerchant } from '@/lib/lunarpay';

async function verifyAdmin() {
  const cookieStore = await cookies();
  const adminToken = cookieStore.get('admin_token')?.value;
  return adminToken && adminToken === process.env.ADMIN_SECRET;
}

export async function GET() {
  if (!(await verifyAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: venues, error } = await supabaseAdmin
    .from('venues')
    .select('*, venue_tokens(token)')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://storypay.io';
  const venuesWithLinks = venues.map((venue: Record<string, unknown>) => {
    const tokens = venue.venue_tokens as { token: string }[] | null;
    const token = tokens?.[0]?.token;
    return {
      ...venue,
      login_url: token ? `${appUrl}/login/${token}` : null,
    };
  });

  return NextResponse.json({ venues: venuesWithLinks });
}

export async function POST(request: Request) {
  if (!(await verifyAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { name, email, firstName, lastName, phone } = body;

  if (!name || !email || !firstName || !lastName) {
    return NextResponse.json(
      { error: 'name, email, firstName, and lastName are required' },
      { status: 400 }
    );
  }

  try {
    const password = `SP_${crypto.randomUUID().slice(0, 12)}`;

    const lpResult = await agencyCreateMerchant({
      email,
      password,
      firstName,
      lastName,
      phone: phone || '',
      businessName: name,
    });

    const merchant = lpResult.data;

    const { data: venue, error: venueError } = await supabaseAdmin
      .from('venues')
      .insert({
        name,
        email,
        phone: phone || null,
        lunarpay_merchant_id: merchant.merchantId,
        lunarpay_organization_id: merchant.organizationId,
        lunarpay_secret_key: merchant.secretKey,
        lunarpay_publishable_key: merchant.publishableKey,
        lunarpay_org_token: merchant.orgToken,
        onboarding_status: merchant.onboardingStatus?.toLowerCase() || 'pending',
        onboarding_mpa_url: merchant.mpaEmbedUrl || null,
      })
      .select()
      .single();

    if (venueError) {
      return NextResponse.json({ error: venueError.message }, { status: 500 });
    }

    const { data: tokenData, error: tokenError } = await supabaseAdmin
      .from('venue_tokens')
      .insert({ venue_id: venue.id })
      .select()
      .single();

    if (tokenError) {
      return NextResponse.json({ error: tokenError.message }, { status: 500 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://storypay.io';

    return NextResponse.json({
      venue: {
        ...venue,
        venue_tokens: [tokenData],
        login_url: `${appUrl}/login/${tokenData.token}`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to provision merchant';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
