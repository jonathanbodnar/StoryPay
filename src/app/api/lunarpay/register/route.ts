/**
 * POST /api/lunarpay/register
 *
 * Step 1 of merchant onboarding.
 * Registers the venue as a sub-merchant under the StoryPay agency account via
 * the LunarPay Agency API. Stores the returned merchantId and orgToken on the
 * venues row so Step 2 (onboarding form submission) can reference them.
 *
 * Body: { firstName, lastName, phone, businessName }
 * (email is taken from the venue's own email)
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const AGENCY_KEY = process.env.LUNARPAY_AGENCY_KEY ?? process.env.LP_AGENCY_KEY ?? '';
const LP_BASE    = process.env.LP_BASE_URL ?? 'https://app.lunarpay.com';

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!AGENCY_KEY) {
    return NextResponse.json({ error: 'Payment processing is not configured on this platform.' }, { status: 503 });
  }

  const body = await request.json() as {
    firstName: string;
    lastName: string;
    phone: string;
    businessName: string;
    password?: string;
  };

  if (!body.firstName?.trim() || !body.lastName?.trim() || !body.businessName?.trim()) {
    return NextResponse.json({ error: 'First name, last name, and business name are required.' }, { status: 400 });
  }

  // Fetch venue email
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('email, lunarpay_merchant_id, onboarding_status')
    .eq('id', venueId)
    .maybeSingle();

  if (!venue?.email) {
    return NextResponse.json({ error: 'Your venue must have an email address configured before applying.' }, { status: 400 });
  }

  // If already registered, return existing status
  if (venue.lunarpay_merchant_id) {
    return NextResponse.json({ merchantId: venue.lunarpay_merchant_id, alreadyRegistered: true });
  }

  // Register with LunarPay Agency API
  const regRes = await fetch(`${LP_BASE}/api/v1/agency/merchants`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${AGENCY_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: venue.email,
      password: body.password ?? `SP-${Math.random().toString(36).slice(2, 10)}!${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      firstName: body.firstName.trim(),
      lastName: body.lastName.trim(),
      phone: body.phone?.trim() || undefined,
      businessName: body.businessName.trim(),
    }),
  });

  if (!regRes.ok) {
    const err = await regRes.json().catch(() => ({})) as { error?: string };
    console.error('[lunarpay/register] LunarPay error', regRes.status, err);
    return NextResponse.json(
      { error: err.error ?? 'Registration failed. Please try again.' },
      { status: regRes.status >= 500 ? 502 : 400 },
    );
  }

  const { data } = await regRes.json() as {
    data: { merchantId: number; publishableKey: string; secretKey: string; orgToken: string };
  };

  // Persist to venues table
  await supabaseAdmin
    .from('venues')
    .update({
      lunarpay_merchant_id: data.merchantId,
      lunarpay_org_token:   data.orgToken,
      onboarding_status:    'registered',
    })
    .eq('id', venueId);

  return NextResponse.json({ merchantId: data.merchantId, orgToken: data.orgToken });
}
