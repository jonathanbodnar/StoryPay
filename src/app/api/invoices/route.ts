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

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;

  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const {
    customerName, customerEmail, customerPhone,
    price, lineItems: lineItemsRaw, paymentType, paymentConfig,
    asDraft,
    appliedCouponId: appliedCouponIdRaw,
    collectManually,
  } = body;

  const collectManuallyFlag = collectManually === true;

  const appliedCouponId =
    typeof appliedCouponIdRaw === 'string' && appliedCouponIdRaw.length > 0
      ? appliedCouponIdRaw
      : null;

  const lineItemsNorm = normalizeLineItemsFromRequest(lineItemsRaw);
  const shouldValidateLineItems =
    Boolean(appliedCouponId) || (Array.isArray(lineItemsRaw) && lineItemsRaw.length > 0);
  const priceCents = typeof price === 'number' && Number.isFinite(price) ? Math.round(price) : 0;

  if (shouldValidateLineItems) {
    const couponCheck = await validateCouponForProposal({
      venueId,
      appliedCouponId,
      lineItems: lineItemsNorm,
      priceCents,
    });
    if (!couponCheck.ok) {
      return NextResponse.json({ error: couponCheck.error }, { status: 400 });
    }
  }

  if (!asDraft) {
    if (!customerName || !customerEmail) {
      return NextResponse.json({ error: 'Customer name and email are required' }, { status: 400 });
    }
    if (!price || price <= 0) {
      return NextResponse.json({ error: 'A valid price is required' }, { status: 400 });
    }
    const termsError = paymentTermsError({ priceCents, paymentType, paymentConfig, collectManually: collectManuallyFlag });
    if (termsError) return NextResponse.json({ error: termsError }, { status: 400 });
  }

  const publicToken = generateToken();
  const invoiceNumber = publicToken.slice(0, 8).toUpperCase();

  const items = lineItemsNorm;

  const formatAmount = (cents: number) =>
    (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

  const itemRows = items
    .map(
      (item) => `
      <tr>
        <td style="padding: 12px 16px; border-bottom: 1px solid #f3f4f6; vertical-align: top;">
          <div style="font-weight: 600; color: #111827; font-size: 14px;">${item.name || '—'}</div>
          ${item.description ? `<div style="color: #6b7280; font-size: 13px; margin-top: 2px;">${item.description}</div>` : ''}
        </td>
        <td style="padding: 12px 16px; border-bottom: 1px solid #f3f4f6; text-align: right; font-size: 14px; color: #111827; white-space: nowrap; vertical-align: top;">
          ${formatAmount(item.amount || 0)}
        </td>
      </tr>`
    )
    .join('');

  const invoiceContent = `
    <div style="font-family: 'Open Sans', Arial, sans-serif;">
      <div style="display: flex; justify-content: space-between; align-items: baseline; margin: 0 0 20px;">
        <h2 style="font-family: 'Open Sans', -apple-system, sans-serif; font-size: 22px; font-weight: 600; color: #111827; margin: 0;">Invoice</h2>
        <span style="font-family: 'Open Sans', -apple-system, sans-serif; font-size: 14px; color: #6b7280; font-weight: 500;">#${invoiceNumber}</span>
      </div>
      <table style="width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
        <thead>
          <tr style="background-color: #f9fafb;">
            <th style="padding: 10px 16px; text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #9ca3af; border-bottom: 1px solid #e5e7eb;">Item / Service</th>
            <th style="padding: 10px 16px; text-align: right; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #9ca3af; border-bottom: 1px solid #e5e7eb;">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows || '<tr><td colspan="2" style="padding: 16px; text-align: center; color: #9ca3af;">No items</td></tr>'}
        </tbody>
        <tfoot>
          <tr style="background-color: #f9fafb;">
            <td style="padding: 12px 16px; font-weight: 700; font-size: 14px; color: #111827; border-top: 2px solid #e5e7eb;">Total</td>
            <td style="padding: 12px 16px; text-align: right; font-weight: 700; font-size: 15px; color: #111827; border-top: 2px solid #e5e7eb;">${formatAmount(price || 0)}</td>
          </tr>
        </tfoot>
      </table>
    </div>`;

  const lineItemsPayload = shouldValidateLineItems ? lineItemsNorm : null;
  const appliedCouponPayload = shouldValidateLineItems ? appliedCouponId : null;

  // Invoices skip the signing flow — they're a one-off bill, not a contract.
  // We mark them as "signed" up-front so the existing payment checkout
  // route (which requires status='signed') accepts them without any
  // changes to the LunarPay checkout flow.
  const nowIso = new Date().toISOString();
  const invoiceRow: Record<string, unknown> = {
    venue_id: venueId,
    customer_name: customerName || null,
    customer_email: customerEmail || null,
    customer_phone: customerPhone || null,
    price: price || 0,
    payment_type: paymentType || 'full',
    payment_config: paymentConfig || {},
    content: invoiceContent,
    status: asDraft ? 'draft' : 'signed',
    is_invoice: true,
    sent_at: asDraft ? null : nowIso,
    signed_at: asDraft ? null : nowIso,
    public_token: publicToken,
    line_items: lineItemsPayload,
    applied_coupon_id: appliedCouponPayload,
    collect_manually: collectManuallyFlag,
  };

  // Tolerant of installs where migration 154 hasn't run: retry without the
  // collect_manually column if it doesn't exist yet.
  let { data: proposal, error } = await supabaseAdmin
    .from('proposals')
    .insert(invoiceRow)
    .select()
    .single();
  if (error && (error.code === '42703' || error.code === 'PGRST204')) {
    const { collect_manually: _cm, ...fallback } = invoiceRow;
    void _cm;
    ({ data: proposal, error } = await supabaseAdmin
      .from('proposals')
      .insert(fallback)
      .select()
      .single());
  }

  if (error || !proposal) {
    console.error('Invoice creation failed:', error);
    return NextResponse.json({ error: 'Failed to create invoice' }, { status: 500 });
  }

  // Once the DB has assigned a sequential proposal_number, swap the temporary
  // token-slice invoice number in the stored content for the real "#1042".
  if (proposal.proposal_number != null) {
    const realNo = String(proposal.proposal_number);
    const patched = invoiceContent.replace(`#${invoiceNumber}`, `#${realNo}`);
    if (patched !== invoiceContent) {
      await supabaseAdmin.from('proposals').update({ content: patched }).eq('id', proposal.id);
      proposal.content = patched;
    }
  }

  if (!asDraft && appliedCouponPayload && proposal.id) {
    const redeem = await recordCouponRedemption({
      venueId,
      couponId: appliedCouponPayload,
      proposalId: proposal.id,
      lineItems: lineItemsNorm,
    });
    if (!redeem.ok) {
      console.error('[invoice] coupon redemption failed:', redeem.error);
    }
  }

  // One branded email (through the venue's CRM when it's connected) and a text.
  if (!asDraft && customerEmail) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    const due = typeof (paymentConfig as { due_date?: unknown } | null)?.due_date === 'string'
      ? String((paymentConfig as { due_date: string }).due_date).slice(0, 10)
      : '';
    await sendClientDocument({
      venueId,
      kind: 'invoice',
      url: `${appUrl}/proposal/${proposal.public_token}`,
      customerName: customerName || '',
      customerEmail,
      customerPhone,
      vars: {
        amount: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((price || 0) / 100),
        invoice_number: invoiceNumber,
        due_date: /^\d{4}-\d{2}-\d{2}$/.test(due)
          ? new Date(`${due}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
          : '',
      },
    });
  }

  // Auto-apply invoice_sent tag if not a draft
  if (!asDraft && customerEmail) {
    ensureSystemTagsForVenue(venueId)
      .then(() => applySystemTagByEmail(venueId, customerEmail, 'invoice_sent'))
      .catch(() => {});
  }

  return NextResponse.json(proposal, { status: 201 });
}
