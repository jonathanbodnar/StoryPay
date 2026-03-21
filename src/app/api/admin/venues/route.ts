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
  try {
    if (!(await verifyAdmin())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      return NextResponse.json({
        error: 'Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Railway.',
      }, { status: 500 });
    }

    const { data: venues, error } = await supabaseAdmin
      .from('venues')
      .select('*, venue_tokens(token)')
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: `Supabase error: ${error.message}` }, { status: 500 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://storypay.io';
    const venuesWithLinks = (venues || []).map((venue: Record<string, unknown>) => {
      const tokens = venue.venue_tokens as { token: string }[] | null;
      const token = tokens?.[0]?.token;
      return {
        ...venue,
        login_url: token ? `${appUrl}/login/${token}` : null,
      };
    });

    return NextResponse.json({ venues: venuesWithLinks });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Server error: ${msg}` }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
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

    let merchantData: Record<string, unknown> = {};

    if (process.env.LP_AGENCY_KEY) {
      const password = `SP_${crypto.randomUUID().slice(0, 12)}`;

      const lpResult = await agencyCreateMerchant({
        email,
        password,
        firstName,
        lastName,
        phone: phone || '',
        businessName: name,
      });

      const merchant = lpResult.data || lpResult;
      merchantData = {
        lunarpay_merchant_id: merchant.merchantId,
        lunarpay_organization_id: merchant.organizationId,
        lunarpay_secret_key: merchant.secretKey,
        lunarpay_publishable_key: merchant.publishableKey,
        lunarpay_org_token: merchant.orgToken,
        onboarding_status: (merchant.onboardingStatus || 'pending').toLowerCase(),
        onboarding_mpa_url: merchant.mpaEmbedUrl || null,
      };
    }

    const { data: venue, error: venueError } = await supabaseAdmin
      .from('venues')
      .insert({
        name,
        email,
        phone: phone || null,
        onboarding_status: 'pending',
        ...merchantData,
      })
      .select()
      .single();

    if (venueError) {
      return NextResponse.json({ error: `DB error: ${venueError.message}` }, { status: 500 });
    }

    const { data: tokenData, error: tokenError } = await supabaseAdmin
      .from('venue_tokens')
      .insert({ venue_id: venue.id })
      .select()
      .single();

    if (tokenError) {
      return NextResponse.json({ error: `Token error: ${tokenError.message}` }, { status: 500 });
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
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Server error: ${msg}` }, { status: 500 });
  }
}
