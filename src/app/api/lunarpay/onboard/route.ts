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

const AGENCY_KEY = process.env.LUNARPAY_AGENCY_KEY ?? process.env.LP_AGENCY_KEY ?? '';
const LP_BASE    = process.env.LP_BASE_URL ?? 'https://app.lunarpay.com';

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
  website?: string;
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

// Fortis underwriting field limits (its API hard-rejects anything longer):
// principal/contact last_name ≤ 20, state_province = 2-letter code,
// bank account_holder_name ≤ 40, website must be non-empty.
const NAME_MAX = 20;
const ACCOUNT_HOLDER_MAX = 40;

const STATE_CODES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO',
  montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH',
  oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
  'district of columbia': 'DC', 'puerto rico': 'PR',
};

/** "Indiana" / "in" / " IN " → "IN"; anything unrecognized → ''. */
function normalizeState(raw: string | undefined): string {
  const s = (raw ?? '').trim();
  if (!s) return '';
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  return STATE_CODES[s.toLowerCase()] ?? '';
}

/** Ensure the URL has a scheme so Fortis accepts it. */
function normalizeWebsite(raw: string | undefined | null): string {
  const s = (raw ?? '').trim();
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!AGENCY_KEY) {
    return NextResponse.json({ error: 'Payment processing is not configured on this platform.' }, { status: 503 });
  }

  const body = await request.json() as OnboardPayload;

  // Fetch merchant id + contact fallbacks. The wizard resumes at Step 2 when
  // the merchant already exists (status "registered"), so Step-1 contact
  // fields may be empty in the payload — fill them from the venue record
  // rather than rejecting a fully-completed banking form.
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('lunarpay_merchant_id, phone, email, owner_first_name, owner_last_name, brand_website, slug')
    .eq('id', venueId)
    .maybeSingle();

  const merchantId = venue?.lunarpay_merchant_id as number | null | undefined;
  if (!merchantId) {
    return NextResponse.json({ error: 'Please complete Step 1 (business registration) first.' }, { status: 400 });
  }

  // Signer name: prefer what the form sent, then the venue owner on file, and
  // only as a last resort split the bank account holder name (which is often a
  // company name, so it must never be the first choice). Clamp to Fortis's
  // 20-char principal-name limit.
  const holderParts = (body.accountHolderName ?? '').trim().split(/\s+/);
  body.firstName = (body.firstName?.trim() || venue?.owner_first_name || holderParts[0] || '').slice(0, NAME_MAX);
  body.lastName  = (body.lastName?.trim()  || venue?.owner_last_name  || holderParts.slice(1).join(' ') || '').slice(0, NAME_MAX);
  body.phone     = body.phone?.trim()     || venue?.phone            || '';
  body.email     = body.email?.trim()     || venue?.email            || '';

  const state = normalizeState(body.state);
  if (!state) {
    return NextResponse.json(
      { error: 'State must be a 2-letter code (e.g. IN for Indiana).' },
      { status: 400 },
    );
  }
  body.state = state;

  // Fortis rejects an empty website. Fall back to the venue's site, then
  // their public StoryVenue listing page (always exists).
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://storypay.io';
  body.website = normalizeWebsite(body.website)
    || normalizeWebsite(venue?.brand_website as string | null)
    || (venue?.slug ? `${appUrl}/venue/${venue.slug}` : '');

  body.accountHolderName = (body.accountHolderName ?? '').trim().slice(0, ACCOUNT_HOLDER_MAX);

  // Validate required fields
  const required: (keyof OnboardPayload)[] = [
    'firstName','lastName','phone','email','dbaName','legalName',
    'addressLine1','city','state','postalCode',
    'routingNumber','accountNumber','accountHolderName',
  ];
  const missing = required.filter((k) => !String(body[k] ?? '').trim());
  if (missing.length) {
    return NextResponse.json(
      { error: `Missing required field${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.` },
      { status: 400 },
    );
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
