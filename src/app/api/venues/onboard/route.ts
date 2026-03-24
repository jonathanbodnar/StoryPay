import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { agencyCreateMerchant, agencyOnboardMerchant } from '@/lib/lunarpay';

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;

  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('lunarpay_merchant_id, onboarding_status, email')
    .eq('id', venueId)
    .single();

  if (!venue) {
    return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  }

  if (venue.onboarding_status && venue.onboarding_status !== 'pending') {
    return NextResponse.json(
      { error: 'Application has already been submitted' },
      { status: 409 }
    );
  }

  const body = await request.json();

  try {
    let merchantId = venue.lunarpay_merchant_id;

    // Auto-create LunarPay merchant if venue was auto-provisioned (no merchant yet)
    if (!merchantId && process.env.LP_AGENCY_KEY) {
      const password = `SP_${crypto.randomUUID().slice(0, 12)}`;
      const email = body.email || venue.email || `venue-${venueId}@storypay.io`;

      const lpResult = await agencyCreateMerchant({
        email,
        password,
        firstName: body.firstName || '',
        lastName: body.lastName || '',
        phone: body.phone || '',
        businessName: body.dbaName || body.legalName || 'New Venue',
      });

      const merchant = lpResult.data || lpResult;
      merchantId = merchant.merchantId;

      await supabaseAdmin
        .from('venues')
        .update({
          lunarpay_merchant_id: merchant.merchantId,
          lunarpay_organization_id: merchant.organizationId,
          lunarpay_secret_key: merchant.secretKey,
          lunarpay_publishable_key: merchant.publishableKey,
          lunarpay_org_token: merchant.orgToken,
          email: email,
        })
        .eq('id', venueId);
    }

    if (!merchantId) {
      return NextResponse.json(
        { error: 'Unable to create payment merchant. Please contact support.' },
        { status: 400 }
      );
    }

    const result = await agencyOnboardMerchant(merchantId, body);
    const data = result.data || result;

    // Update venue with onboarding status and business name
    const updateData: Record<string, unknown> = {
      onboarding_status: (data.status || 'bank_information_sent').toLowerCase(),
      onboarding_mpa_url: data.mpaEmbedUrl || data.mpaLink || null,
    };

    const businessName = body.dbaName || body.legalName;
    if (businessName) {
      updateData.name = businessName;
    }
    if (body.email) updateData.email = body.email;
    if (body.phone) updateData.phone = body.phone;
    if (body.addressLine1) updateData.address = body.addressLine1;
    if (body.city) updateData.city = body.city;
    if (body.state) updateData.state = body.state;
    if (body.postalCode) updateData.zip = body.postalCode;

    await supabaseAdmin
      .from('venues')
      .update(updateData)
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
