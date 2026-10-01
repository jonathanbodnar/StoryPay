import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { paymentTermsError } from '@/lib/payment-plan';
import { supabaseAdmin } from '@/lib/supabase';
import { generateToken } from '@/lib/utils';
import { sendClientDocument } from '@/lib/client-document-send';
import { applySystemTagByEmail, ensureSystemTagsForVenue } from '@/lib/system-tags';
import {
  normalizeLineItemsFromRequest,
  validateCouponForProposal,
  recordCouponRedemption,
} from '@/lib/venue-coupons-server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;

  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limit = request.nextUrl.searchParams.get('limit');
  const status = request.nextUrl.searchParams.get('status');

  // Select only the columns needed for the proposals list — avoids
  // transferring large JSONB fields (content, signature_fields, line_items,
  // payment_config) for what is typically a 5–20 row table widget.
  // Sticks to the original public schema; fields like proposal_type,
  // deposit_pct, override_conflict don't exist on every install.
  const BASE_COLS =
    'id, public_token, customer_name, customer_email, customer_lunarpay_id, ' +
    'status, price, payment_type, sent_at, paid_at, signed_at, ' +
    'created_at, updated_at, template_id';

  async function runQuery(cols: string) {
    let q = supabaseAdmin
      .from('proposals')
      .select(cols)
      .eq('venue_id', venueId)
      .order('created_at', { ascending: false });
    if (status) q = q.eq('status', status);
    if (limit) q = q.limit(parseInt(limit, 10));
    return q;
  }

  // Prefer to include the newer columns; degrade gracefully if a migration
  // (154 collect_manually / 156 proposal_number) hasn't been applied yet.
  const colVariants = [
    BASE_COLS + ', collect_manually, proposal_number, is_invoice, require_signature',
    BASE_COLS + ', collect_manually, proposal_number',
    BASE_COLS + ', collect_manually',
    BASE_COLS,
  ];
  let data: unknown[] | null = null;
  let error: { code?: string; message?: string; details?: string } | null = null;
  for (const cols of colVariants) {
    ({ data, error } = await runQuery(cols));
    if (!error) break;
    if (error.code !== '42703' && error.code !== 'PGRST204') break;
  }

  if (error) {
    console.error('[proposals GET] supabase error', { venueId, code: error.code, message: error.message, details: error.details });
    return NextResponse.json({ error: error.message, code: error.code }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;

  // Merge in manual-payment totals so the list can show paid/balance. Tolerant
  // of the proposal_payments table not existing yet.
  try {
    const { data: pays } = await supabaseAdmin
      .from('proposal_payments')
      .select('proposal_id, amount_cents')
      .eq('venue_id', venueId);
    if (pays && pays.length) {
      const totals = new Map<string, number>();
      for (const p of pays) {
        const pid = String(p.proposal_id);
        totals.set(pid, (totals.get(pid) ?? 0) + (Number(p.amount_cents) || 0));
      }
      for (const r of rows) {
        r.total_paid_cents = totals.get(String(r.id)) ?? 0;
      }
    }
  } catch { /* proposal_payments not available yet — skip totals */ }

  // Flag bookings whose automatic payment failed, for the list's filter.
  const { data: failed } = await supabaseAdmin
    .from('proposal_installments')
    .select('proposal_id')
    .eq('venue_id', venueId)
    .eq('status', 'failed');
  const failedIds = new Set(((failed ?? []) as Array<{ proposal_id: string }>).map((r) => r.proposal_id));
  if (failedIds.size) for (const r of rows) if (failedIds.has(String(r.id))) r.payment_failed = true;

  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;

  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const {
    templateId, customerName, customerEmail, customerPhone,
    ghlContactId, customerId,
    price, paymentType, paymentConfig,
    asDraft,
    acceptAch,
    lineItems: lineItemsRaw,
    appliedCouponId: appliedCouponIdRaw,
    overrideContent,
    collectManually,
    requireSignature,
  } = body;

  // Manual-collection proposals suppress the online payment form; the owner
  // records cash/check payments from the dashboard instead.
  const collectManuallyFlag = collectManually === true;
  const requireSignatureFlag = requireSignature !== false;

  // templateId is optional when overrideContent is provided (AI-generated or freeform contract)
  if (!templateId && !body.overrideContent) {
    return NextResponse.json({ error: 'templateId is required (or provide overrideContent for a freeform contract)' }, { status: 400 });
  }

  const isDraft = !!asDraft;

  const appliedCouponId =
    typeof appliedCouponIdRaw === 'string' && appliedCouponIdRaw.length > 0
      ? appliedCouponIdRaw
      : null;

  const lineItems = normalizeLineItemsFromRequest(lineItemsRaw);
  const shouldValidateLineItems =
    Boolean(appliedCouponId) || (Array.isArray(lineItemsRaw) && lineItemsRaw.length > 0);
  const priceCents = typeof price === 'number' && Number.isFinite(price) ? Math.round(price) : 0;

  if (shouldValidateLineItems) {
    const couponCheck = await validateCouponForProposal({
      venueId,
      appliedCouponId,
      lineItems,
      priceCents,
    });
    if (!couponCheck.ok) {
      return NextResponse.json({ error: couponCheck.error }, { status: 400 });
    }
  }

  if (!isDraft) {
    if (!customerName || !customerEmail) {
      return NextResponse.json(
        { error: 'customerName and customerEmail are required to send' },
        { status: 400 }
      );
    }
    if (!price || price <= 0) {
      return NextResponse.json({ error: 'A valid price is required' }, { status: 400 });
    }
    const termsError = paymentTermsError({ priceCents, paymentType, paymentConfig, collectManually: collectManuallyFlag });
    if (termsError) return NextResponse.json({ error: termsError }, { status: 400 });
  }

  const contentForProposal =
    typeof overrideContent === 'string' && overrideContent.trim().length > 0
      ? overrideContent
      : null;

  // Fetch the template and its signature fields in parallel.
  let template: { content: string } | null = null;
  let sigFields: unknown[] = [];

  if (templateId) {
    const [
      { data: tmplData, error: templateError },
      { data: sigData },
    ] = await Promise.all([
      supabaseAdmin
        .from('proposal_templates')
        .select('content')
        .eq('id', templateId)
        .eq('venue_id', venueId)
        .single(),
      supabaseAdmin
        .from('proposal_template_fields')
        .select('id, field_type, label, sort_order, required')
        .eq('template_id', templateId)
        .order('sort_order', { ascending: true }),
    ]);

    if (templateError || !tmplData) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }
    template = tmplData;
    sigFields = sigData ?? [];
  }

  const resolvedContent = contentForProposal ?? template?.content ?? '';

  const publicToken = generateToken();

  const lineItemsPayload = shouldValidateLineItems ? lineItems : null;
  const appliedCouponPayload = shouldValidateLineItems ? appliedCouponId : null;

  // Insert tolerant of installs where migration 154 (manual payment columns)
  // hasn't run yet: retry once without collect_manually/require_signature.
  async function insertProposalRow(row: Record<string, unknown>) {
    let res = await supabaseAdmin.from('proposals').insert(row).select().single();
    if (res.error && (res.error.code === '42703' || res.error.code === 'PGRST204')) {
      const { collect_manually: _cm, require_signature: _rs, ...fallback } = row;
      void _cm; void _rs;
      res = await supabaseAdmin.from('proposals').insert(fallback).select().single();
    }
    return res;
  }

  if (isDraft) {
    const { data: proposal, error: insertError } = await insertProposalRow({
      venue_id: venueId,
      template_id: templateId ?? null,
      customer_name: customerName || null,
      customer_email: customerEmail || null,
      customer_phone: customerPhone || null,
      content: resolvedContent,
      price: price || 0,
      payment_type: paymentType || 'full',
      payment_config: paymentConfig || {},
      accept_ach: acceptAch !== false,
      signature_fields: sigFields ?? [],
      public_token: publicToken,
      status: 'draft',
      line_items: lineItemsPayload,
      applied_coupon_id: appliedCouponPayload,
      collect_manually: collectManuallyFlag,
      require_signature: requireSignatureFlag,
    });

    if (insertError) {
      console.error('[proposals POST draft] insert failed', { venueId, code: insertError.code, message: insertError.message, details: insertError.details, hint: insertError.hint });
      return NextResponse.json({ error: insertError.message, code: insertError.code, hint: insertError.hint }, { status: 500 });
    }

    return NextResponse.json(proposal, { status: 201 });
  }

  // --- Sending flow ---

  // LunarPay is retired (lib/lunarpay-retired.ts): nothing is created there.
  const customerLunarpayId = customerId || null;

  // 2. Insert proposal
  const { data: proposal, error: insertError } = await insertProposalRow({
    venue_id: venueId,
    template_id: templateId ?? null,
    customer_name: customerName,
    customer_email: customerEmail,
    customer_phone: customerPhone || null,
    customer_lunarpay_id: customerLunarpayId,
    content: resolvedContent,
    price,
    payment_type: paymentType || 'full',
    payment_config: paymentConfig || {},
    accept_ach: acceptAch !== false,
    signature_fields: sigFields ?? [],
    public_token: publicToken,
    status: 'sent',
    sent_at: new Date().toISOString(),
    line_items: lineItemsPayload,
    applied_coupon_id: appliedCouponPayload,
    collect_manually: collectManuallyFlag,
    require_signature: requireSignatureFlag,
  });

  if (insertError) {
    console.error('[proposals POST send] insert failed', { venueId, code: insertError.code, message: insertError.message, details: insertError.details, hint: insertError.hint });
    return NextResponse.json({ error: insertError.message, code: insertError.code, hint: insertError.hint }, { status: 500 });
  }

  if (appliedCouponPayload && proposal?.id) {
    const redeem = await recordCouponRedemption({
      venueId,
      couponId: appliedCouponPayload,
      proposalId: proposal.id,
      lineItems,
    });
    if (!redeem.ok) {
      console.error('[proposal-send] coupon redemption failed:', redeem.error);
    }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
  const proposalUrl = `${appUrl}/proposal/${publicToken}`;

  // 3. One branded email (through the venue's CRM when it's connected) and a text.
  await sendClientDocument({
    venueId,
    kind: 'proposal',
    url: proposalUrl,
    customerName,
    customerEmail,
    customerPhone,
    ghlContactId: ghlContactId || null,
    vars: { amount: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((price ?? 0) / 100) },
  });

  // Auto-apply proposal_sent tag
  if (customerEmail) {
    ensureSystemTagsForVenue(venueId)
      .then(() => applySystemTagByEmail(venueId, customerEmail, 'proposal_sent'))
      .catch(() => {});
  }

  return NextResponse.json(proposal, { status: 201 });
}
