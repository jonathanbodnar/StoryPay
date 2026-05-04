/**
 * Reproduce the EXACT payload our proposal-checkout route sends, against
 * LunarPay's /api/v1/checkout/sessions, using the venue's stored secret key.
 *
 *   GET /api/admin/test-lunarpay-proposal?token=<public_token>
 *   GET /api/admin/test-lunarpay-proposal?proposalId=<uuid>
 *
 * Returns the request body and LunarPay's raw response so we can pinpoint
 * exactly which field (or merchant config) is causing the 500.
 *
 * Use when /api/admin/test-lunarpay-checkout's progressive payloads pass
 * but the real proposal flow still 500s — the difference is real customer
 * data (email format, name characters, amount, metadata values).
 *
 * Admin-cookie gated.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyAdminCookie } from '@/lib/admin-auth';

const LP_BASE_URL = process.env.LP_BASE_URL || 'https://app.lunarpay.com';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.storypay.io';

interface Installment { amount: number; date: string }
interface InstallmentConfig { installments: Installment[] }
interface SubscriptionConfig { amount: number; frequency: string; start_date: string }

function applyFee(cents: number, ratePercent: number): number {
  if (ratePercent <= 0) return cents;
  return Math.round(cents * (1 + ratePercent / 100));
}

export async function GET(req: NextRequest) {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const token = req.nextUrl.searchParams.get('token');
  const proposalId = req.nextUrl.searchParams.get('proposalId');
  if (!token && !proposalId) {
    return NextResponse.json(
      { error: 'Pass ?token=<public_token> or ?proposalId=<uuid>' },
      { status: 400 },
    );
  }

  const proposalQuery = supabaseAdmin
    .from('proposals')
    .select('id, public_token, venue_id, status, price, customer_name, customer_email, payment_type, payment_config');

  const { data: proposal, error: pErr } = await (token
    ? proposalQuery.eq('public_token', token).single()
    : proposalQuery.eq('id', proposalId).single());

  if (pErr || !proposal) {
    return NextResponse.json(
      { error: 'Proposal not found', detail: pErr?.message },
      { status: 404 },
    );
  }

  const { data: venue, error: vErr } = await supabaseAdmin
    .from('venues')
    .select('id, name, lunarpay_secret_key, service_fee_rate, accept_ach')
    .eq('id', proposal.venue_id)
    .single();
  if (vErr || !venue) {
    return NextResponse.json(
      { error: 'Venue not found', detail: vErr?.message },
      { status: 404 },
    );
  }
  if (!venue.lunarpay_secret_key) {
    return NextResponse.json(
      { error: 'Venue has no lunarpay_secret_key' },
      { status: 400 },
    );
  }

  const key = venue.lunarpay_secret_key as string;
  const keyPrefix = `${key.slice(0, 10)}…${key.slice(-4)}`;
  const feeRate = Number(venue.service_fee_rate ?? 0);
  const addFee = feeRate > 0;
  const acceptAch = (venue as { accept_ach?: boolean | null }).accept_ach !== false;

  let chargeAmountCents = proposal.price;
  let description = `${venue.name} - Proposal Payment`;
  if (proposal.payment_type === 'installment' && proposal.payment_config) {
    const config = proposal.payment_config as InstallmentConfig;
    const installments = config.installments || [];
    if (installments.length > 0) {
      chargeAmountCents = installments[0].amount;
      description = `${venue.name} - Payment 1 of ${installments.length}`;
    }
  } else if (proposal.payment_type === 'subscription' && proposal.payment_config) {
    const config = proposal.payment_config as SubscriptionConfig;
    if (config.amount) {
      chargeAmountCents = config.amount;
      description = `${venue.name} - First ${config.frequency} payment`;
    }
  }
  const finalCents = addFee ? applyFee(chargeAmountCents, feeRate) : chargeAmountCents;
  const amountInDollars = finalCents / 100;

  const checkoutData: Record<string, unknown> = {
    amount: amountInDollars,
    description,
    customer_email: proposal.customer_email,
    customer_name: proposal.customer_name,
    success_url: `${APP_URL}/proposal/${proposal.public_token}/success`,
    cancel_url: `${APP_URL}/proposal/${proposal.public_token}`,
    metadata: { proposal_id: proposal.id, public_token: proposal.public_token },
  };
  if (!acceptAch) {
    checkoutData.payment_methods = ['cc'];
  }

  // First do a key-health check so we know whether the merchant is ACTIVE.
  let onboardingStatus: { status: number; response: unknown } | null = null;
  try {
    const r = await fetch(`${LP_BASE_URL}/api/v1/onboarding/status`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const text = await r.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* keep as string */ }
    onboardingStatus = { status: r.status, response: parsed };
  } catch (err) {
    onboardingStatus = { status: 0, response: err instanceof Error ? err.message : String(err) };
  }

  // Now hit /api/v1/checkout/sessions with the EXACT proposal payload.
  let checkoutResponse: { status: number; response: unknown; reqHeaders: Record<string, string> } | null = null;
  try {
    const r = await fetch(`${LP_BASE_URL}/api/v1/checkout/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(checkoutData),
    });
    const text = await r.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* keep as string */ }
    const reqHeaders: Record<string, string> = {};
    r.headers.forEach((v, k) => { reqHeaders[k] = v; });
    checkoutResponse = { status: r.status, response: parsed, reqHeaders };
  } catch (err) {
    checkoutResponse = {
      status: 0,
      response: err instanceof Error ? err.message : String(err),
      reqHeaders: {},
    };
  }

  return NextResponse.json({
    venue: { id: venue.id, name: venue.name },
    proposal: {
      id: proposal.id,
      token: proposal.public_token,
      status: proposal.status,
      payment_type: proposal.payment_type,
      price_cents: proposal.price,
      customer_email: proposal.customer_email,
      customer_name: proposal.customer_name,
    },
    keyPrefix,
    lpBaseUrl: LP_BASE_URL,
    requestSent: {
      url: `${LP_BASE_URL}/api/v1/checkout/sessions`,
      method: 'POST',
      body: checkoutData,
    },
    onboardingStatus,
    checkoutResponse,
  }, { status: 200 });
}
