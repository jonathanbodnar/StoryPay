/**
 * POST /api/admin/venues/[id]/lunarpay
 *
 * Super-admin actions on a venue's LunarPay merchant pairing:
 *
 *   { action: "sync" }   — re-fetch live status/keys from the LunarPay Agency
 *                          API and persist them (fixes stale pills).
 *   { action: "reset" }  — put the application back at the banking step
 *                          (onboarding_status = "registered") so the venue can
 *                          resubmit. Safe: LunarPay's onboard endpoint is
 *                          idempotent and returns the existing Fortis MPA link
 *                          if one was already created. Refused when the
 *                          merchant is live-approved.
 *   { action: "unlink" } — detach the merchant entirely (clears all lunarpay_*
 *                          columns, status back to "not_started") so the venue
 *                          restarts the wizard from scratch. If the venue
 *                          re-registers with the same email, the register
 *                          route re-adopts this same merchant; a true brand-new
 *                          Fortis application requires a different email (or
 *                          deleting the merchant in the LunarPay admin portal).
 *                          Refused when the merchant is live-approved.
 *
 * Master super admin only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyMasterAdminOnly } from '@/lib/admin-auth';
import { normalizeLunarPayStatus } from '@/lib/lunarpay-status';
import { getLunarPayAdminSummary } from '@/lib/lunarpay-venue-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const AGENCY_KEY = process.env.LUNARPAY_AGENCY_KEY ?? process.env.LP_AGENCY_KEY ?? '';
const LP_BASE    = process.env.LP_BASE_URL ?? 'https://app.lunarpay.com';

type LiveMerchant = {
  isActive: boolean;
  status: string;
  secretKey?: string;
  publishableKey?: string;
  orgToken?: string;
  organizationId?: number;
};

async function fetchLiveMerchant(merchantId: number): Promise<LiveMerchant | null> {
  if (!AGENCY_KEY) return null;
  const res = await fetch(`${LP_BASE}/api/v1/agency/merchants/${merchantId}`, {
    headers: { 'Authorization': `Bearer ${AGENCY_KEY}` },
    next: { revalidate: 0 },
  });
  if (!res.ok) return null;
  const { data } = await res.json() as {
    data?: {
      isActive?: boolean;
      organizationId?: number;
      orgToken?: string;
      publishableKey?: string;
      secretKey?: string;
      onboarding?: { status?: string };
    };
  };
  if (!data) return null;
  const status = (data.onboarding?.status ?? '').toUpperCase();
  return {
    isActive: data.isActive === true || status === 'ACTIVE',
    status,
    secretKey: data.secretKey,
    publishableKey: data.publishableKey,
    orgToken: data.orgToken,
    organizationId: data.organizationId,
  };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await verifyMasterAdminOnly())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id: venueId } = await params;

  let body: { action?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const action = body.action;
  if (action !== 'sync' && action !== 'reset' && action !== 'unlink') {
    return NextResponse.json({ error: 'action must be "sync", "reset", or "unlink".' }, { status: 400 });
  }

  const { data: venue, error: readErr } = await supabaseAdmin
    .from('venues')
    .select('id, name, email, lunarpay_merchant_id, onboarding_status')
    .eq('id', venueId)
    .maybeSingle();
  if (readErr || !venue) {
    return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  }

  const merchantId = venue.lunarpay_merchant_id as number | null;
  if (!merchantId) {
    return NextResponse.json({ error: 'This venue has no LunarPay merchant to act on.' }, { status: 400 });
  }

  const live = await fetchLiveMerchant(merchantId);

  if (action === 'sync') {
    if (!live) {
      return NextResponse.json({ error: 'Could not reach LunarPay for a live status.' }, { status: 502 });
    }
    const fallback = normalizeLunarPayStatus(venue.onboarding_status as string, 'registered');
    const updates: Record<string, unknown> = {
      onboarding_status: live.isActive ? 'active' : normalizeLunarPayStatus(live.status.toLowerCase(), fallback),
    };
    if (live.secretKey)      updates.lunarpay_secret_key      = live.secretKey;
    if (live.publishableKey) updates.lunarpay_publishable_key = live.publishableKey;
    if (live.orgToken)       updates.lunarpay_org_token       = live.orgToken;
    if (live.organizationId) updates.lunarpay_organization_id = live.organizationId;

    const { error } = await supabaseAdmin.from('venues').update(updates).eq('id', venueId);
    if (error) return NextResponse.json({ error: `Save failed: ${error.message}` }, { status: 500 });

    return NextResponse.json({
      ok: true,
      status: updates.onboarding_status,
      summary: getLunarPayAdminSummary({ ...venue, ...updates }),
    });
  }

  // reset / unlink both refuse to touch a live-approved merchant.
  if (live?.isActive || venue.onboarding_status === 'active') {
    return NextResponse.json(
      { error: 'This merchant is approved and active — resetting would disconnect live payments. Sync instead.' },
      { status: 409 },
    );
  }

  if (action === 'reset') {
    const { error } = await supabaseAdmin
      .from('venues')
      .update({ onboarding_status: 'registered' })
      .eq('id', venueId);
    if (error) return NextResponse.json({ error: `Save failed: ${error.message}` }, { status: 500 });
    return NextResponse.json({
      ok: true,
      status: 'registered',
      message: 'Application reset. The venue will resume at the banking step and can resubmit; if Fortis already issued an MPA form, resubmitting returns the same form.',
    });
  }

  // unlink
  const { error } = await supabaseAdmin
    .from('venues')
    .update({
      lunarpay_merchant_id: null,
      lunarpay_organization_id: null,
      lunarpay_secret_key: null,
      lunarpay_publishable_key: null,
      lunarpay_org_token: null,
      onboarding_mpa_url: null,
      onboarding_status: 'not_started',
    })
    .eq('id', venueId);
  if (error) return NextResponse.json({ error: `Save failed: ${error.message}` }, { status: 500 });

  console.log('[admin/venues/lunarpay] unlinked merchant', { venueId, merchantId, admin: true });
  return NextResponse.json({
    ok: true,
    status: 'not_started',
    message: `Merchant #${merchantId} detached. The venue starts the wizard fresh; re-registering with the same email re-adopts this merchant, so use a different email (or delete the merchant in LunarPay admin) if a brand-new Fortis application is needed.`,
  });
}
