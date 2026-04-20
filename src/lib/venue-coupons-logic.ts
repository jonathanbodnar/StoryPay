export type VenueCouponRow = {
  id: string;
  venue_id: string;
  code: string;
  name: string;
  description: string | null;
  discount_type: 'percent' | 'fixed_cents';
  discount_percent: string | number | null;
  discount_amount_cents: number | null;
  max_redemptions: number | null;
  uses_count: number;
  active: boolean;
};

export type LineItemPayload = {
  name: string;
  description?: string;
  amount: number;
  isCoupon?: boolean;
  couponId?: string;
  isSurcharge?: boolean;
};

export function merchantSubtotalCents(items: LineItemPayload[]): number {
  return items
    .filter((i) => !i.isSurcharge && !i.isCoupon)
    .reduce((s, i) => s + Math.max(0, i.amount || 0), 0);
}

export function computeDiscountCents(coupon: VenueCouponRow, merchantSubtotalCents: number): number {
  if (merchantSubtotalCents <= 0) return 0;
  if (coupon.discount_type === 'percent') {
    const p = Number(coupon.discount_percent);
    if (!Number.isFinite(p) || p <= 0 || p > 100) return 0;
    return Math.round((merchantSubtotalCents * p) / 100);
  }
  const fixed = coupon.discount_amount_cents ?? 0;
  return Math.min(fixed, merchantSubtotalCents);
}

export function sumLineItemsCents(items: LineItemPayload[]): number {
  return items.reduce((s, i) => s + (i.amount || 0), 0);
}

/** Returns discount cents from coupon lines (should be negative amounts stored as positive discount value for compare) */
export function couponDiscountFromLines(items: LineItemPayload[]): number {
  let d = 0;
  for (const i of items) {
    if (!i.isCoupon) continue;
    const a = i.amount || 0;
    d += a < 0 ? -a : a;
  }
  return d;
}

export function canRedeemCoupon(coupon: VenueCouponRow): { ok: true } | { ok: false; reason: string } {
  if (!coupon.active) return { ok: false, reason: 'Coupon is inactive.' };
  if (coupon.max_redemptions == null) return { ok: true };
  if (coupon.uses_count >= coupon.max_redemptions) {
    return { ok: false, reason: 'This coupon has no remaining uses.' };
  }
  return { ok: true };
}

export function validateLineItemsAgainstCoupon(
  coupon: VenueCouponRow | null,
  items: LineItemPayload[],
  claimedPriceCents: number,
  appliedCouponId: string | null | undefined,
): { ok: true } | { ok: false; error: string } {
  const sum = sumLineItemsCents(items);
  if (sum !== claimedPriceCents) {
    return { ok: false, error: 'Line items do not match total.' };
  }
  if (!appliedCouponId || !coupon) {
    const hasCouponLine = items.some((i) => i.isCoupon);
    if (hasCouponLine) return { ok: false, error: 'Invalid coupon line.' };
    return { ok: true };
  }

  const merchant = merchantSubtotalCents(items);
  const expected = computeDiscountCents(coupon, merchant);
  const fromLines = couponDiscountFromLines(items);
  if (fromLines !== expected) {
    return { ok: false, error: 'Discount does not match coupon rules for current line items.' };
  }

  const couponLines = items.filter((i) => i.isCoupon);
  if (couponLines.length !== 1) {
    return { ok: false, error: 'Apply exactly one coupon line.' };
  }
  if (couponLines[0].couponId !== coupon.id) {
    return { ok: false, error: 'Coupon mismatch.' };
  }
  const c = canRedeemCoupon(coupon);
  if (!c.ok) return { ok: false, error: c.reason };
  return { ok: true };
}
