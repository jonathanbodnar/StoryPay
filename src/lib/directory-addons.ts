/**
 * Pricing + plan-inclusion logic for the Verified and Sponsored add-ons.
 *
 * Used by:
 * - Plans & Billing page    → render addon checkboxes + live total
 * - Verified & Sponsored    → render "Included" vs "$X/mo" CTAs
 * - Billing API endpoints   → compute the LunarPay charge amount
 * - Plan change endpoint    → respect inclusion when computing new charge
 *
 * Single source of truth so prices and inclusion rules stay in sync.
 */

export const VERIFIED_PRICE_CENTS = 1900; // $19.00 / mo
export const SPONSORED_PRICE_CENTS = 9900; // $99.00 / mo

export type AddonKey = 'verified' | 'sponsored';

export const ADDON_PRICE_CENTS: Record<AddonKey, number> = {
  verified: VERIFIED_PRICE_CENTS,
  sponsored: SPONSORED_PRICE_CENTS,
};

export const ADDON_LABEL: Record<AddonKey, string> = {
  verified: 'Verified Listing',
  sponsored: 'Sponsored Listing',
};

// ── Plan inclusion ─────────────────────────────────────────────────────────
//
// Each `directory_plans.feature_flags` JSON object can carry two booleans:
//   • includes_verified_addon   → bundles Verified at no extra charge
//   • includes_sponsored_addon  → bundles Sponsored at no extra charge
//
// When unset, we fall back to a price-tier inference so existing plans don't
// need a database edit to behave correctly:
//   • Top-priced plan       → both included
//   • 2nd-highest paid plan → verified included
//   • Everything else       → neither included
//
// `feature_flags` always wins when explicitly set so super admin can override.

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

/**
 * Does this plan include Verified at no extra charge?
 * `allPlans` provides the context for the price-tier fallback.
 */
export function planIncludesVerified<T extends PlanLike>(plan: T | null, allPlans: T[]): boolean {
  if (!plan) return false;
  const explicit = readBoolFlag(plan, 'includes_verified_addon');
  if (explicit !== null) return explicit;

  const ranked = rankPaidPlans(allPlans);
  if (ranked.length === 0) return false;
  // Top plan AND second-from-top both include verified.
  if (plan.id === ranked[0]?.id) return true;
  if (plan.id === ranked[1]?.id) return true;
  return false;
}

/**
 * Does this plan include Sponsored at no extra charge?
 * Only the highest-priced paid plan includes sponsored under the inferred
 * defaults; flags can override per-plan.
 */
export function planIncludesSponsored<T extends PlanLike>(plan: T | null, allPlans: T[]): boolean {
  if (!plan) return false;
  const explicit = readBoolFlag(plan, 'includes_sponsored_addon');
  if (explicit !== null) return explicit;

  const ranked = rankPaidPlans(allPlans);
  if (ranked.length === 0) return false;
  return plan.id === ranked[0]?.id;
}

// ── Effective addon resolution ─────────────────────────────────────────────

export type EffectiveAddons = {
  /** Final state shown in the UI: included or user-toggled. */
  verified: boolean;
  sponsored: boolean;
  /** Forced by the plan (locked-checked, not the user's choice). */
  verifiedFromPlan: boolean;
  sponsoredFromPlan: boolean;
  /** User's stored toggles (only billed when not already included). */
  verifiedUser: boolean;
  sponsoredUser: boolean;
};

export function resolveEffectiveAddons<T extends PlanLike>(opts: {
  plan: T | null;
  allPlans: T[];
  addonVerifiedUser: boolean;
  addonSponsoredUser: boolean;
}): EffectiveAddons {
  const verifiedFromPlan = planIncludesVerified(opts.plan, opts.allPlans);
  const sponsoredFromPlan = planIncludesSponsored(opts.plan, opts.allPlans);
  return {
    verified: verifiedFromPlan || opts.addonVerifiedUser,
    sponsored: sponsoredFromPlan || opts.addonSponsoredUser,
    verifiedFromPlan,
    sponsoredFromPlan,
    verifiedUser: opts.addonVerifiedUser,
    sponsoredUser: opts.addonSponsoredUser,
  };
}

// ── Total monthly charge ───────────────────────────────────────────────────

export type ChargeBreakdown = {
  plan_cents: number;
  verified_cents: number;
  sponsored_cents: number;
  total_cents: number;
};

/**
 * Total billed monthly for the venue. Add-on prices ONLY apply when the user
 * has opted in AND their plan does not include the addon for free.
 */
export function computeMonthlyTotalCents<T extends PlanLike>(opts: {
  plan: T | null;
  allPlans: T[];
  addonVerifiedUser: boolean;
  addonSponsoredUser: boolean;
}): ChargeBreakdown {
  const plan_cents = opts.plan?.price_monthly_cents ?? 0;
  const eff = resolveEffectiveAddons(opts);
  const verified_cents = !eff.verifiedFromPlan && eff.verifiedUser ? VERIFIED_PRICE_CENTS : 0;
  const sponsored_cents = !eff.sponsoredFromPlan && eff.sponsoredUser ? SPONSORED_PRICE_CENTS : 0;
  return {
    plan_cents,
    verified_cents,
    sponsored_cents,
    total_cents: plan_cents + verified_cents + sponsored_cents,
  };
}
