/**
 * Admin endpoint: register and onboard "StoryPay HQ" as a merchant on
 * LunarPay using the agency key. This is the merchant StoryPay uses to
 * collect SaaS subscription fees from venues — separate from the agency
 * key (which only registers other merchants) and from each venue's own
 * merchant key (which collects payments from end-clients).
 *
 * Run once. After Fortis approves the application (1–3 business days),
 * the merchant.approved webhook fires with the secret/publishable keys —
 * see /api/webhooks/lunarpay for handling. Copy them into Railway as
 * STORYPAY_HQ_LUNARPAY_SK / STORYPAY_HQ_LUNARPAY_PK.
 *
 * Usage:
 *   POST /api/admin/storypay-hq/onboard
 *   Body (all optional, defaults shown):
 *   {
 *     "register": true,                 // step 1
 *     "submitMpa": true,                // step 2
 *     "registerBody":  { ... full register payload ... },
 *     "onboardBody":   { ... full onboard payload ... }
 *   }
 *
 * On success returns:
 *   {
 *     register:  { merchantId, orgToken, publishableKey, secretKey } | null,
 *     onboard:   { mpaLink, mpaEmbedUrl, status, ... } | null
 *   }
 *
 * Requires the admin cookie. Requires LP_AGENCY_KEY in env.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';

const LP_BASE_URL = process.env.LP_BASE_URL || 'https://app.lunarpay.com';

type RegisterBody = {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string;
  businessName: string;
};

type OnboardBody = Record<string, unknown> & {
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
  routingNumber?: string;
  accountNumber?: string;
  accountHolderName?: string;
  ccMonthlyVolumeRange: number;
  ccAverageTicketRange: number;
  ccHighTicket: number;
  ecMonthlyVolumeRange?: number;
  ecAverageTicketRange?: number;
  ecHighTicket?: number;
};

function generatePassword(): string {
  const a = Math.random().toString(36).slice(2, 12);
  const b = Math.random().toString(36).slice(2, 8).toUpperCase();
  const c = Math.floor(Math.random() * 9000 + 1000);
  return `SPHQ-${a}-${b}!${c}`;
}

const DEFAULT_REGISTER: RegisterBody = {
  email: 'billing@storypay.app',
  password: generatePassword(),
  firstName: 'StoryPay',
  lastName: 'Billing',
  phone: '5550000000',
  businessName: 'StoryPay',
};

export async function POST(req: NextRequest) {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const agencyKey = process.env.LP_AGENCY_KEY?.trim();
  if (!agencyKey) {
    return NextResponse.json(
      { error: 'LP_AGENCY_KEY is not set on the server.' },
      { status: 503 },
    );
  }
  if (!agencyKey.startsWith('lp_agency_')) {
    return NextResponse.json(
      {
        error:
          'LP_AGENCY_KEY does not start with "lp_agency_" — that env var must hold the agency key, not a merchant key.',
      },
      { status: 503 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    register?: boolean;
    submitMpa?: boolean;
    registerBody?: Partial<RegisterBody>;
    onboardBody?: Partial<OnboardBody>;
    merchantId?: number;
  };

  const shouldRegister = body.register !== false;
  const shouldSubmit   = Boolean(body.submitMpa);

  let registerResult:
    | { merchantId: number; orgToken: string; publishableKey: string; secretKey: string }
    | null = null;
  let onboardResult: Record<string, unknown> | null = null;
  let merchantId: number | undefined = body.merchantId;

  if (shouldRegister) {
    const payload: RegisterBody = { ...DEFAULT_REGISTER, ...(body.registerBody ?? {}) };
    const res = await fetch(`${LP_BASE_URL}/api/v1/agency/merchants`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${agencyKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* keep as string */ }
    if (!res.ok) {
      return NextResponse.json(
        { step: 'register', status: res.status, response: parsed, requestPayload: { ...payload, password: '<redacted>' } },
        { status: res.status >= 500 ? 502 : 400 },
      );
    }
    const data = (parsed as { data?: { merchantId: number; orgToken: string; publishableKey: string; secretKey: string } }).data;
    if (!data?.merchantId) {
      return NextResponse.json(
        { step: 'register', error: 'LunarPay returned no merchantId', response: parsed },
        { status: 502 },
      );
    }
    registerResult = data;
    merchantId = data.merchantId;
  }

  if (shouldSubmit) {
    if (!merchantId) {
      return NextResponse.json(
        { error: 'submitMpa requires a merchantId — pass it in the body or run with register=true first.' },
        { status: 400 },
      );
    }
    const payload = body.onboardBody;
    if (!payload) {
      return NextResponse.json(
        {
          error:
            'submitMpa=true requires onboardBody — pass the full Fortis MPA application payload (legalName, addressLine1, EIN/tax id, banking, volume ranges, etc.).',
        },
        { status: 400 },
      );
    }
    const res = await fetch(
      `${LP_BASE_URL}/api/v1/agency/merchants/${merchantId}/onboard`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${agencyKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
    );
    const text = await res.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* keep as string */ }
    if (!res.ok) {
      return NextResponse.json(
        { step: 'submitMpa', status: res.status, response: parsed, merchantId },
        { status: res.status >= 500 ? 502 : 400 },
      );
    }
    onboardResult = parsed as Record<string, unknown>;
  }

  return NextResponse.json({
    ok: true,
    note:
      'StoryPay HQ merchant created. Save the keys below in your password manager — they are NOT logged. Once Fortis approves (1–3 business days), the merchant.approved webhook will fire and log the same keys; copy them into Railway as STORYPAY_HQ_LUNARPAY_SK / STORYPAY_HQ_LUNARPAY_PK / STORYPAY_HQ_LUNARPAY_MERCHANT_ID.',
    register: registerResult,
    onboard:  onboardResult,
    merchantId,
  });
}
