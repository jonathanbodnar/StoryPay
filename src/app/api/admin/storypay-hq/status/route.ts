/**
 * Admin endpoint: report StoryPay HQ's merchant status on LunarPay.
 *
 *   GET  /api/admin/storypay-hq/status
 *   GET  /api/admin/storypay-hq/status?merchantId=123
 *
 * Returns:
 *   - whether STORYPAY_HQ_LUNARPAY_SK / PK / MERCHANT_ID are set in env
 *   - if a merchantId is known (from env or query): the agency-API record
 *     for that merchant, including onboarding status and keys
 *   - if STORYPAY_HQ_LUNARPAY_SK is set: the merchant's own
 *     /api/v1/onboarding/status (isActive flag)
 *
 * Use this to confirm the HQ merchant is ACTIVE before relying on it for
 * SaaS billing.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import {
  getPlatformLunarPaySecretKey,
  getPlatformLunarPayPublishableKey,
} from '@/lib/platform-directory-billing';

const LP_BASE_URL = process.env.LP_BASE_URL || 'https://app.lunarpay.com';

function maskKey(k: string | null | undefined): string | null {
  if (!k) return null;
  if (k.length < 14) return '<too short>';
  return `${k.slice(0, 10)}…${k.slice(-4)}`;
}

export async function GET(req: NextRequest) {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const agencyKey = process.env.LP_AGENCY_KEY?.trim() || '';
  const hqSk      = getPlatformLunarPaySecretKey();
  const hqPk      = getPlatformLunarPayPublishableKey();
  const hqIdEnv   = process.env.STORYPAY_HQ_LUNARPAY_MERCHANT_ID?.trim();
  const queryId   = req.nextUrl.searchParams.get('merchantId');
  const targetId  = queryId || hqIdEnv;

  const env = {
    LP_AGENCY_KEY:                   maskKey(agencyKey || null),
    STORYPAY_HQ_LUNARPAY_SK:         maskKey(hqSk),
    STORYPAY_HQ_LUNARPAY_PK:         maskKey(hqPk),
    STORYPAY_HQ_LUNARPAY_MERCHANT_ID: hqIdEnv ?? null,
  };

  const result: Record<string, unknown> = { env, lpBaseUrl: LP_BASE_URL };

  // If we have an agency key + a merchant id, get the agency's view of HQ.
  if (agencyKey && targetId) {
    try {
      const res = await fetch(`${LP_BASE_URL}/api/v1/agency/merchants/${targetId}`, {
        headers: { Authorization: `Bearer ${agencyKey}` },
      });
      const text = await res.text();
      let parsed: unknown = text;
      try { parsed = JSON.parse(text); } catch { /* keep as string */ }
      result.agencyMerchantRecord = { status: res.status, response: parsed };
    } catch (err) {
      result.agencyMerchantRecord = { error: err instanceof Error ? err.message : String(err) };
    }
  }

  // If we have HQ's own secret key, ask LunarPay if the merchant is ACTIVE.
  if (hqSk) {
    try {
      const res = await fetch(`${LP_BASE_URL}/api/v1/onboarding/status`, {
        headers: { Authorization: `Bearer ${hqSk}` },
      });
      const text = await res.text();
      let parsed: unknown = text;
      try { parsed = JSON.parse(text); } catch { /* keep as string */ }
      result.hqOnboardingStatus = { status: res.status, response: parsed };
    } catch (err) {
      result.hqOnboardingStatus = { error: err instanceof Error ? err.message : String(err) };
    }
  }

  if (!agencyKey) {
    result.hint = 'LP_AGENCY_KEY is not set on the server. Set it to your lp_agency_… key.';
  } else if (!targetId) {
    result.hint =
      'No merchantId known. Either set STORYPAY_HQ_LUNARPAY_MERCHANT_ID in env (after onboarding) or pass ?merchantId=<id> in the URL. To onboard StoryPay HQ for the first time, POST /api/admin/storypay-hq/onboard.';
  } else if (!hqSk) {
    result.hint =
      'STORYPAY_HQ_LUNARPAY_SK is not set yet. Once Fortis approves the merchant, the merchant.approved webhook will log the keys — copy them into Railway env and redeploy.';
  }

  return NextResponse.json(result);
}
