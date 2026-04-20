import { supabaseAdmin } from '@/lib/supabase';
import {
  canRedeemCoupon,
  couponDiscountFromLines,
  type LineItemPayload,
  type VenueCouponRow,
  validateLineItemsAgainstCoupon,
} from '@/lib/venue-coupons-logic';

export function normalizeLineItemsFromRequest(raw: unknown): LineItemPayload[] {
  if (!Array.isArray(raw)) return [];
  const out: LineItemPayload[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    const name = typeof o.name === 'string' ? o.name : '';
    const description = typeof o.description === 'string' ? o.description : '';
    const amount = typeof o.amount === 'number' && Number.isFinite(o.amount) ? Math.round(o.amount) : 0;
    out.push({
      name,
      description,
      amount,
      isCoupon: o.isCoupon === true,
      couponId: typeof o.couponId === 'string' ? o.couponId : undefined,
      isSurcharge: o.isSurcharge === true,
    });
  }
  return out;
}

export async function validateCouponForProposal(params: {
  venueId: string;
  appliedCouponId: string | null;
  lineItems: LineItemPayload[];
  priceCents: number;
}): Promise<{ ok: true; coupon: VenueCouponRow | null } | { ok: false; error: string }> {
  const { appliedCouponId, lineItems, priceCents, venueId } = params;

  if (!appliedCouponId) {
    const v = validateLineItemsAgainstCoupon(null, lineItems, priceCents, null);
    return v.ok ? { ok: true, coupon: null } : { ok: false, error: v.error };
  }

  const { data: coupon, error } = await supabaseAdmin
    .from('venue_coupons')
    .select('*')
    .eq('id', appliedCouponId)
    .eq('venue_id', venueId)
    .single();

  if (error || !coupon) {
    return { ok: false, error: 'Coupon not found.' };
  }

  const c = coupon as VenueCouponRow;
  const v = validateLineItemsAgainstCoupon(c, lineItems, priceCents, appliedCouponId);
  if (!v.ok) return { ok: false, error: v.error };

  const can = canRedeemCoupon(c);
  if (!can.ok) return { ok: false, error: can.reason };

  return { ok: true, coupon: c };
}

export async function recordCouponRedemption(params: {
  venueId: string;
  couponId: string;
  proposalId: string;
  lineItems: LineItemPayload[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: existing } = await supabaseAdmin
    .from('coupon_redemptions')
    .select('id')
    .eq('proposal_id', params.proposalId)
    .maybeSingle();
  if (existing) return { ok: true };

  const discountCents = couponDiscountFromLines(params.lineItems);
  if (discountCents <= 0) {
    return { ok: false, error: 'Invalid coupon discount.' };
  }

  const { data: cpn, error: fetchErr } = await supabaseAdmin
    .from('venue_coupons')
    .select('*')
    .eq('id', params.couponId)
    .eq('venue_id', params.venueId)
    .single();

  if (fetchErr || !cpn) return { ok: false, error: 'Coupon not found.' };
  const row = cpn as VenueCouponRow;
  const can = canRedeemCoupon(row);
  if (!can.ok) return { ok: false, error: can.reason };

  const { error: insErr } = await supabaseAdmin.from('coupon_redemptions').insert({
    coupon_id: params.couponId,
    venue_id: params.venueId,
    proposal_id: params.proposalId,
    discount_cents: discountCents,
  });

  if (insErr) {
    console.error('[coupon_redemptions]', insErr.message);
    return { ok: false, error: insErr.message };
  }

  const { error: upErr } = await supabaseAdmin
    .from('venue_coupons')
    .update({ uses_count: row.uses_count + 1 })
    .eq('id', params.couponId)
    .eq('venue_id', params.venueId);

  if (upErr) {
    console.error('[venue_coupons uses_count]', upErr.message);
    return { ok: false, error: upErr.message };
  }

  return { ok: true };
}
