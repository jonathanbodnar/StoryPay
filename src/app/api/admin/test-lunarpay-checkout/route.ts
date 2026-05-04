export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyAdminCookie } from '@/lib/admin-auth';

const LP_BASE_URL = process.env.LP_BASE_URL || 'https://app.lunarpay.com';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.storypay.io';

interface ProgressivePayload {
  label: string;
  body: Record<string, unknown>;
}

/**
 * Diagnostic endpoint that tries a series of checkout payloads with
 * progressively more fields, returning the result of each. Helps
 * isolate which exact field causes a 500 from LunarPay.
 *
 * Usage:
 *   GET /api/admin/test-lunarpay-checkout?venueId=<uuid>
 *
 * Requires the admin cookie set.
 */
export async function GET(req: NextRequest) {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const venueId = req.nextUrl.searchParams.get('venueId');
  if (!venueId) {
    return NextResponse.json({ error: 'venueId query param required' }, { status: 400 });
  }

  const { data: venue, error } = await supabaseAdmin
    .from('venues')
    .select('id, name, lunarpay_secret_key')
    .eq('id', venueId)
    .single();

  if (error || !venue) {
    return NextResponse.json({ error: 'Venue not found', detail: error?.message }, { status: 404 });
  }
  if (!venue.lunarpay_secret_key) {
    return NextResponse.json({ error: 'Venue has no lunarpay_secret_key' }, { status: 400 });
  }

  const key = venue.lunarpay_secret_key as string;
  const keyPrefix = `${key.slice(0, 10)}...${key.slice(-4)}`;

  const baseline: Record<string, unknown> = {
    amount: 1.00,
    description: `${venue.name} - test`,
    customer_email: 'test@example.com',
    customer_name: 'Test Customer',
    success_url: `${APP_URL}/test/success`,
    cancel_url: `${APP_URL}/test/cancel`,
  };

  const tests: ProgressivePayload[] = [
    { label: '1. baseline (6 docs fields, no metadata)', body: baseline },
    {
      label: '2. baseline + metadata',
      body: { ...baseline, metadata: { test: 'true' } },
    },
    {
      label: '3. baseline + payment_methods=[cc]',
      body: { ...baseline, payment_methods: ['cc'] },
    },
    {
      label: '4. baseline + payment_methods=[cc,ach]',
      body: { ...baseline, payment_methods: ['cc', 'ach'] },
    },
    {
      label: '5. baseline + metadata + payment_methods=[cc,ach]',
      body: {
        ...baseline,
        metadata: { proposal_id: 'test-uuid', public_token: 'test-token' },
        payment_methods: ['cc', 'ach'],
      },
    },
    {
      label: '6. baseline + expires_in',
      body: { ...baseline, expires_in: 3600 },
    },
  ];

  const results: Array<{
    label: string;
    method: string;
    path: string;
    request?: Record<string, unknown>;
    status: number;
    response: unknown;
  }> = [];

  // 0a. Onboarding status — the most important diagnostic. If isActive is
  // false, the merchant cannot process payments yet (Fortis hasn't approved
  // them). Checkout will return 403/500 until they're ACTIVE.
  try {
    const res = await fetch(`${LP_BASE_URL}/api/v1/onboarding/status`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
    });
    const text = await res.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* keep as string */ }
    results.push({
      label: '0a. ONBOARDING STATUS — is this merchant ACTIVE on Fortis?',
      method: 'GET',
      path: '/api/v1/onboarding/status',
      status: res.status,
      response: parsed,
    });
  } catch (err) {
    results.push({
      label: '0a. ONBOARDING STATUS — is this merchant ACTIVE on Fortis?',
      method: 'GET',
      path: '/api/v1/onboarding/status',
      status: 0,
      response: err instanceof Error ? err.message : String(err),
    });
  }

  // 0b. Sanity: does the key work at all on a non-checkout endpoint?
  try {
    const res = await fetch(`${LP_BASE_URL}/api/v1/customers?page=1&limit=1`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
    });
    const text = await res.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* keep as string */ }
    results.push({
      label: '0b. KEY-CHECK GET /customers (does the key work at all?)',
      method: 'GET',
      path: '/api/v1/customers',
      status: res.status,
      response: parsed,
    });
  } catch (err) {
    results.push({
      label: '0b. KEY-CHECK GET /customers (does the key work at all?)',
      method: 'GET',
      path: '/api/v1/customers',
      status: 0,
      response: err instanceof Error ? err.message : String(err),
    });
  }

  // 1-N. Progressive checkout payloads
  for (const t of tests) {
    try {
      const res = await fetch(`${LP_BASE_URL}/api/v1/checkout/sessions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(t.body),
      });
      const text = await res.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        // keep as string
      }
      results.push({
        label: t.label,
        method: 'POST',
        path: '/api/v1/checkout/sessions',
        request: t.body,
        status: res.status,
        response: parsed,
      });
    } catch (err) {
      results.push({
        label: t.label,
        method: 'POST',
        path: '/api/v1/checkout/sessions',
        request: t.body,
        status: 0,
        response: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    venue: { id: venue.id, name: venue.name },
    keyPrefix,
    keyLength: key.length,
    lpBaseUrl: LP_BASE_URL,
    results,
  }, { status: 200 });
}
