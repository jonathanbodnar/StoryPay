/**
 * GET /api/lunarpay/status
 *
 * Returns the venue's current LunarPay onboarding status.
 * Polls the LunarPay Agency API for real-time status and syncs the result
 * back to the venues table so the UI always has fresh data.
 */
import { NextResponse } from 'next/server';
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

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('lunarpay_merchant_id, lunarpay_org_token, onboarding_status, lunarpay_secret_key, lunarpay_publishable_key')
    .eq('id', venueId)
    .maybeSingle();

  type VenueRow = {
    lunarpay_merchant_id?: number | null;
    lunarpay_org_token?: string | null;
    onboarding_status?: string | null;
    lunarpay_secret_key?: string | null;
    lunarpay_publishable_key?: string | null;
  };
  const v = venue as VenueRow | null;

  if (!v?.lunarpay_merchant_id) {
    return NextResponse.json({ status: 'not_started', isActive: false });
  }

  // If already active we can skip the live poll
  if (v.onboarding_status === 'active' && v.lunarpay_secret_key) {
    return NextResponse.json({
      status: 'active',
      isActive: true,
      merchantId: v.lunarpay_merchant_id,
      orgToken: v.lunarpay_org_token,
      mpaEmbedUrl: v.lunarpay_org_token
        ? `https://app.lunarpay.com/onboarding/${v.lunarpay_org_token}`
        : null,
    });
  }

  if (!AGENCY_KEY) {
    return NextResponse.json({
      status: normalizeLunarPayStatus(v.onboarding_status, 'registered'),
      isActive: false,
      merchantId: v.lunarpay_merchant_id,
    });
  }

  // Fetch live status from LunarPay
  try {
    const lpRes = await fetch(`${LP_BASE}/api/v1/agency/merchants/${v.lunarpay_merchant_id}`, {
      headers: { 'Authorization': `Bearer ${AGENCY_KEY}` },
      next: { revalidate: 0 },
    });

    if (!lpRes.ok) throw new Error(`LunarPay ${lpRes.status}`);

    type MerchantData = {
      status?: string;
      isActive?: boolean;
      onboarding?: { status?: string };
      publishableKey?: string;
      secretKey?: string;
      orgToken?: string;
      mpaEmbedUrl?: string;
    };
    const { data } = await lpRes.json() as { data: MerchantData };
    const lpStatus = (data?.onboarding?.status ?? data?.status ?? '').toUpperCase();
    const isActive = data?.isActive === true || lpStatus === 'ACTIVE';

    // CRITICAL: never write a raw LunarPay status (DOCUMENTATION_REQUIRED,
    // IN_REVIEW, etc.) into the DB column — the wizard can't render unknown
    // values and the venue ends up shown the wrong step. Map everything into
    // the canonical set. We use the venue's CURRENT status as the fallback so
    // an unrecognized response can't regress the state backward.
    const fallbackStatus = normalizeLunarPayStatus(v.onboarding_status, 'registered');
    const normalized = normalizeLunarPayStatus(lpStatus.toLowerCase(), fallbackStatus);

    const updates: Record<string, unknown> = { onboarding_status: normalized };

    if (isActive && data?.secretKey && data?.publishableKey) {
      updates.lunarpay_secret_key = data.secretKey;
      updates.lunarpay_publishable_key = data.publishableKey;
      updates.onboarding_status = 'active';
    } else if (isActive) {
      updates.onboarding_status = 'active';
    }
    if (data?.orgToken) updates.lunarpay_org_token = data.orgToken;

    await supabaseAdmin.from('venues').update(updates).eq('id', venueId);

    return NextResponse.json({
      status: (updates.onboarding_status as string) ?? normalized,
      isActive,
      merchantId: v.lunarpay_merchant_id,
      orgToken: data?.orgToken ?? v.lunarpay_org_token,
      mpaEmbedUrl: data?.mpaEmbedUrl ??
        (v.lunarpay_org_token ? `https://app.lunarpay.com/onboarding/${v.lunarpay_org_token}` : null),
    });
  } catch (err) {
    console.error('[lunarpay/status]', err);
    // Return cached status on network error
    return NextResponse.json({
      status: normalizeLunarPayStatus(v.onboarding_status, 'registered'),
      isActive: false,
      merchantId: v.lunarpay_merchant_id,
      orgToken: v.lunarpay_org_token,
      mpaEmbedUrl: v.lunarpay_org_token
        ? `https://app.lunarpay.com/onboarding/${v.lunarpay_org_token}`
        : null,
    });
  }
}
