/**
 * Pricing + plan-inclusion/availability logic for all directory add-ons.
 *
 * Add-ons:
 *   verified   — Verified Listing badge ($19/mo)
 *   sponsored  — Sponsored Listing top placement ($99/mo)
 *   concierge  — Venue Concierge (personal + AI lead follow-up) ($297/mo)
 *
 * Used by:
 * - Plans & Billing page    → render addon checkboxes + live total
 * - Verified & Sponsored    → render "Included" vs "$X/mo" CTAs
 * - Billing API endpoints   → compute the LunarPay charge amount
 * - Plan change endpoint    → respect inclusion when computing new charge
 *
 * Single source of truth so prices and inclusion rules stay in sync.
 */

export const VERIFIED_PRICE_CENTS   = 1900;  // $19.00 / mo
export const SPONSORED_PRICE_CENTS  = 9900;  // $99.00 / mo
/**
 * Venue Concierge: personal + AI forever-follow-up lead concierge.
 * Update this constant to change the global price.
 */
export const CONCIERGE_PRICE_CENTS  = 29700; // $297.00 / mo

export type AddonKey = 'verified' | 'sponsored' | 'concierge';

export const ADDON_PRICE_CENTS: Record<AddonKey, number> = {
  verified:  VERIFIED_PRICE_CENTS,
  sponsored: SPONSORED_PRICE_CENTS,
  concierge: CONCIERGE_PRICE_CENTS,
};

export const ADDON_LABEL: Record<AddonKey, string> = {
  verified:  'Verified Listing',
  sponsored: 'Sponsored Listing',
  concierge: 'Venue Concierge',
};

// ── Plan inclusion + availability ──────────────────────────────────────────
//
// `feature_flags` keys on directory_plans:
//
//  Verified / Sponsored (always shown, availability inferred from price tier):
//    addon_verified_included    → bundles Verified at no extra charge
//    addon_sponsored_included   → bundles Sponsored at no extra charge
//
//  Concierge (hidden unless explicitly unlocked per plan):
//    addon_concierge_available  → plan allows venues to purchase this addon
//    addon_concierge_included   → addon is auto-included at no extra charge

type PlanLike = {
  id: string;
  price_monthly_cents?: number | null;
  feature_flags?: Record<string, unknown> | null | undefined;
};

function readBoolFlag(plan: PlanLike, key: string): boolean | null {
  const ff = plan.feature_flags;
  if (!ff || typeof ff !== 'object') return null;
  const v = (ff as Record<string, unknown>)[key];
  if (typeof v === 'boolean') return v;
  return null;
}

/** Sort plans by descending price, putting paid plans first. */
function rankPaidPlans<T extends PlanLike>(allPlans: T[]): T[] {
  return [...allPlans]
    .filter((p) => (p.price_monthly_cents ?? 0) > 0)
    .sort((a, b) => (b.price_monthly_cents ?? 0) - (a.price_monthly_cents ?? 0));
}

// ── Verified ───────────────────────────────────────────────────────────────

export function planIncludesVerified<T extends PlanLike>(plan: T | null, allPlans: T[]): boolean {
  if (!plan) return false;
  const explicit = readBoolFlag(plan, 'includes_verified_addon');
  if (explicit !== null) return explicit;

  const ranked = rankPaidPlans(allPlans);
  if (ranked.length === 0) return false;
  if (plan.id === ranked[0]?.id) return true;
  if (plan.id === ranked[1]?.id) return true;
  return false;
}

// ── Sponsored ──────────────────────────────────────────────────────────────

export function planIncludesSponsored<T extends PlanLike>(plan: T | null, allPlans: T[]): boolean {
  if (!plan) return false;
  const explicit = readBoolFlag(plan, 'includes_sponsored_addon');
  if (explicit !== null) return explicit;

  const ranked = rankPaidPlans(allPlans);
  if (ranked.length === 0) return false;
  return plan.id === ranked[0]?.id;
}

// ── Concierge ──────────────────────────────────────────────────────────────

/**
 * Is the Venue Concierge add-on purchasable on this plan?
 * Returns true only when the plan has addon_concierge_available = true in
 * feature_flags. This lets the super admin restrict the concierge addon to
 * specific plans (e.g. highest tier only).
 */
export function planConciergeAvailable<T extends PlanLike>(plan: T | null): boolean {
  if (!plan) return false;
  return readBoolFlag(plan, 'addon_concierge_available') === true;
}

/**
 * Is the Venue Concierge add-on auto-included (no extra charge) on this plan?
 */
export function planIncludesConcierge<T extends PlanLike>(plan: T | null): boolean {
  if (!plan) return false;
  return readBoolFlag(plan, 'addon_concierge_included') === true;
}

// ── Effective addon resolution ─────────────────────────────────────────────

export type EffectiveAddons = {
  verified: boolean;
  sponsored: boolean;
  concierge: boolean;
  verifiedFromPlan: boolean;
  sponsoredFromPlan: boolean;
  conciergeFromPlan: boolean;
  /** True when the plan allows the concierge addon to be purchased */
  conciergeAvailable: boolean;
  verifiedUser: boolean;
  sponsoredUser: boolean;
  conciergeUser: boolean;
};

export function resolveEffectiveAddons<T extends PlanLike>(opts: {
  plan: T | null;
  allPlans: T[];
  addonVerifiedUser: boolean;
  addonSponsoredUser: boolean;
  addonConciergeUser?: boolean;
}): EffectiveAddons {
  const verifiedFromPlan   = planIncludesVerified(opts.plan, opts.allPlans);
  const sponsoredFromPlan  = planIncludesSponsored(opts.plan, opts.allPlans);
  const conciergeFromPlan  = planIncludesConcierge(opts.plan);
  const conciergeAvailable = planConciergeAvailable(opts.plan);
  const addonConciergeUser = opts.addonConciergeUser ?? false;

  return {
    verified:           verifiedFromPlan  || opts.addonVerifiedUser,
    sponsored:          sponsoredFromPlan || opts.addonSponsoredUser,
    concierge:          conciergeFromPlan || addonConciergeUser,
    verifiedFromPlan,
    sponsoredFromPlan,
    conciergeFromPlan,
    conciergeAvailable,
    verifiedUser:  opts.addonVerifiedUser,
    sponsoredUser: opts.addonSponsoredUser,
    conciergeUser: addonConciergeUser,
  };
}

// ── Total monthly charge ───────────────────────────────────────────────────

export type ChargeBreakdown = {
  plan_cents: number;
  verified_cents: number;
  sponsored_cents: number;
  concierge_cents: number;
  total_cents: number;
};

/**
 * Total billed monthly for the venue. Add-on prices ONLY apply when the user
 * has opted in AND their plan does not include the addon for free.
 *
 * `addonConciergeUser` is optional (defaults false) so existing callers
 * compile unchanged — they simply won't bill concierge until they're updated.
 */
export function computeMonthlyTotalCents<T extends PlanLike>(opts: {
  plan: T | null;
  allPlans: T[];
  addonVerifiedUser: boolean;
  addonSponsoredUser: boolean;
  addonConciergeUser?: boolean;
}): ChargeBreakdown {
  const plan_cents = opts.plan?.price_monthly_cents ?? 0;
  const eff = resolveEffectiveAddons(opts);
  const verified_cents  = !eff.verifiedFromPlan  && eff.verifiedUser  ? VERIFIED_PRICE_CENTS  : 0;
  const sponsored_cents = !eff.sponsoredFromPlan && eff.sponsoredUser ? SPONSORED_PRICE_CENTS : 0;
  const concierge_cents = !eff.conciergeFromPlan && eff.conciergeUser ? CONCIERGE_PRICE_CENTS : 0;
  return {
    plan_cents,
    verified_cents,
    sponsored_cents,
    concierge_cents,
    total_cents: plan_cents + verified_cents + sponsored_cents + concierge_cents,
  };
}
