/**
 * POST /api/lunarpay/onboard
 *
 * Step 2 of merchant onboarding.
 * Submits the Fortis MPA business & banking details for the already-registered
 * merchant. Returns the mpaEmbedUrl that the frontend should display in an
 * iframe so the merchant can complete the Fortis Merchant Processing Agreement.
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const AGENCY_KEY = process.env.LUNARPAY_AGENCY_KEY ?? '';
const LP_BASE    = 'https://app.lunarpay.com';

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

export interface OnboardPayload {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  dbaName: string;
  legalName: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  routingNumber: string;
  accountNumber: string;
  accountHolderName: string;
  ccMonthlyVolumeRange: number;  // 1–7
  ccAverageTicketRange: number;  // 1–7
  ccHighTicket: number;          // dollars, 1–30000
  ecMonthlyVolumeRange: number;
  ecAverageTicketRange: number;
  ecHighTicket: number;
}

export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!AGENCY_KEY) {
    return NextResponse.json({ error: 'Payment processing is not configured on this platform.' }, { status: 503 });
  }

  const body = await request.json() as OnboardPayload;

  // Validate required fields
  const required: (keyof OnboardPayload)[] = [
    'firstName','lastName','phone','email','dbaName','legalName',
    'addressLine1','city','state','postalCode',
    'routingNumber','accountNumber','accountHolderName',
  ];
  for (const k of required) {
    if (!String(body[k] ?? '').trim()) {
      return NextResponse.json({ error: `"${k}" is required.` }, { status: 400 });
    }
  }

  // Fetch merchant id
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('lunarpay_merchant_id')
    .eq('id', venueId)
    .maybeSingle();

  const merchantId = (venue as { lunarpay_merchant_id?: number | null } | null)?.lunarpay_merchant_id;
  if (!merchantId) {
    return NextResponse.json({ error: 'Please complete Step 1 (business registration) first.' }, { status: 400 });
  }

  const lpRes = await fetch(`${LP_BASE}/api/v1/agency/merchants/${merchantId}/onboard`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${AGENCY_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!lpRes.ok) {
    const err = await lpRes.json().catch(() => ({})) as { error?: string };
    console.error('[lunarpay/onboard] LunarPay error', lpRes.status, err);
    return NextResponse.json(
      { error: err.error ?? 'Onboarding submission failed. Please check your details and try again.' },
      { status: lpRes.status >= 500 ? 502 : 400 },
    );
  }

  const result = await lpRes.json() as { mpaEmbedUrl?: string; data?: { mpaEmbedUrl?: string } };
  const mpaEmbedUrl = result.mpaEmbedUrl ?? result.data?.mpaEmbedUrl ?? null;

  // Save onboarding data + status
  await supabaseAdmin
    .from('venues')
    .update({
      lunarpay_onboard_data: body as unknown as Record<string, unknown>,
      onboarding_status:     'bank_information_sent',
    })
    .eq('id', venueId);

  return NextResponse.json({ mpaEmbedUrl });
}
