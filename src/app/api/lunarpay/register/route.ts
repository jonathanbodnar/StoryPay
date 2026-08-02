/**
 * POST /api/lunarpay/register
 *
 * Step 1 of merchant onboarding.
 * Registers the venue as a sub-merchant under the StoryPay agency account via
 * the LunarPay Agency API. Stores the returned merchantId and orgToken on the
 * venues row so Step 2 (onboarding form submission) can reference them.
 *
 * If LunarPay reports the venue's email is already registered (409), we look
 * the merchant up in our agency's merchant list and adopt it instead of
 * failing — this heals venues whose first registration succeeded at LunarPay
 * but was never persisted here (the "double submission" dead-end).
 *
 * Body: { firstName, lastName, phone, businessName }
 * (email is taken from the venue's own email)
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';
import { normalizeLunarPayStatus } from '@/lib/lunarpay-status';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const AGENCY_KEY = process.env.LUNARPAY_AGENCY_KEY ?? process.env.LP_AGENCY_KEY ?? '';
const LP_BASE    = process.env.LP_BASE_URL ?? 'https://app.lunarpay.com';

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

interface MerchantIdentifiers {
  merchantId: number;
  organizationId?: number | null;
  orgToken?: string | null;
  publishableKey?: string | null;
  secretKey?: string | null;
  onboardingStatus?: string | null;
}

/**
 * The venue's email already has a LunarPay account. If that merchant belongs
 * to OUR agency, fetch its identifiers so the venue row can be paired with it.
 * Returns null when no merchant with that email is visible to our agency key
 * (e.g. the email was used for a direct app.lunarpay.com signup).
 */
async function findAgencyMerchantByEmail(email: string): Promise<MerchantIdentifiers | null> {
  const target = email.trim().toLowerCase();
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(`${LP_BASE}/api/v1/agency/merchants?page=${page}&limit=100`, {
      headers: { 'Authorization': `Bearer ${AGENCY_KEY}` },
    });
    if (!res.ok) return null;
    const json = await res.json() as {
      data?: { merchantId: number; email?: string }[];
      pagination?: { pages?: number };
    };
    const rows = json.data ?? [];
    const hit = rows.find((m) => (m.email ?? '').trim().toLowerCase() === target);
    if (hit) {
      // The list omits API keys — fetch the single-merchant detail for them.
      const detRes = await fetch(`${LP_BASE}/api/v1/agency/merchants/${hit.merchantId}`, {
        headers: { 'Authorization': `Bearer ${AGENCY_KEY}` },
      });
      if (!detRes.ok) return { merchantId: hit.merchantId };
      const det = await detRes.json() as {
        data?: {
          merchantId: number; organizationId?: number; orgToken?: string;
          publishableKey?: string; secretKey?: string;
          onboarding?: { status?: string };
        };
      };
      const d = det.data;
      if (!d) return { merchantId: hit.merchantId };
      return {
        merchantId:       d.merchantId,
        organizationId:   d.organizationId ?? null,
        orgToken:         d.orgToken ?? null,
        publishableKey:   d.publishableKey ?? null,
        secretKey:        d.secretKey ?? null,
        onboardingStatus: d.onboarding?.status ?? null,
      };
    }
    if (page >= (json.pagination?.pages ?? 1)) break;
  }
  return null;
}

/** Persist merchant identifiers on the venue row; throws on DB failure so the
 *  caller can surface it instead of leaving an orphaned LunarPay merchant. */
async function persistMerchant(venueId: string, m: MerchantIdentifiers): Promise<void> {
  const update: Record<string, unknown> = {
    lunarpay_merchant_id: m.merchantId,
    onboarding_status: normalizeLunarPayStatus(m.onboardingStatus, 'registered'),
  };
  if (m.organizationId) update.lunarpay_organization_id = m.organizationId;
  if (m.orgToken)       update.lunarpay_org_token       = m.orgToken;
  if (m.publishableKey) update.lunarpay_publishable_key = m.publishableKey;
  if (m.secretKey)      update.lunarpay_secret_key      = m.secretKey;

  const { error } = await supabaseAdmin.from('venues').update(update).eq('id', venueId);
  if (error) {
    console.error('[lunarpay/register] venue persist FAILED', { venueId, merchantId: m.merchantId, error });
    throw new Error('Your merchant account was created but could not be saved. Please try again — it will reconnect automatically.');
  }
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
    const duplicateEmail = regRes.status === 409 || /already exists/i.test(err.error ?? '');

    if (duplicateEmail) {
      // The email already has a LunarPay account — usually an earlier attempt
      // that never got saved here. Adopt it if it's ours.
      const existing = await findAgencyMerchantByEmail(venue.email).catch(() => null);
      if (existing) {
        try {
          await persistMerchant(venueId, existing);
        } catch (e) {
          return NextResponse.json({ error: (e as Error).message }, { status: 500 });
        }
        console.log('[lunarpay/register] adopted existing merchant', { venueId, merchantId: existing.merchantId });
        return NextResponse.json({ merchantId: existing.merchantId, orgToken: existing.orgToken, adopted: true });
      }
      return NextResponse.json(
        { error: `${venue.email} already has a LunarPay account outside StoryPay. Contact support to link it.` },
        { status: 409 },
      );
    }

    console.error('[lunarpay/register] LunarPay error', regRes.status, err);
    return NextResponse.json(
      { error: err.error ?? 'Registration failed. Please try again.' },
      { status: regRes.status >= 500 ? 502 : 400 },
    );
  }

  const { data } = await regRes.json() as {
    data: {
      merchantId: number; organizationId?: number;
      publishableKey: string; secretKey: string; orgToken: string;
    };
  };

  // Persist to venues table. Merchant created at LunarPay but no banking/MPA
  // form submitted yet.
  try {
    await persistMerchant(venueId, {
      merchantId:     data.merchantId,
      organizationId: data.organizationId ?? null,
      orgToken:       data.orgToken,
      publishableKey: data.publishableKey,
      secretKey:      data.secretKey,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  return NextResponse.json({ merchantId: data.merchantId, orgToken: data.orgToken });
}
