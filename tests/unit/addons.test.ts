import { describe, expect, it } from 'vitest';
import {
  computeMonthlyTotalCents,
  DEFAULT_ADDON_PRICES,
  planConciergeAvailable,
  planIncludesConcierge,
  planIncludesSponsored,
  planIncludesVerified,
  resolveEffectiveAddons,
} from '@/lib/directory-addons';

type Plan = { id: string; price_monthly_cents: number; feature_flags?: Record<string, unknown> };
const free: Plan = { id: 'free', price_monthly_cents: 0 };
const booking: Plan = { id: 'booking', price_monthly_cents: 9700 };
const pro: Plan = { id: 'pro', price_monthly_cents: 19700 };
const elite: Plan = { id: 'elite', price_monthly_cents: 49700 };
const plans = [free, booking, pro, elite];

describe('what a plan includes', () => {
  it('the two priciest paid plans include Verified; the free plan never does', () => {
    expect(planIncludesVerified(elite, plans)).toBe(true);
    expect(planIncludesVerified(pro, plans)).toBe(true);
    expect(planIncludesVerified(booking, plans)).toBe(false);
    expect(planIncludesVerified(free, plans)).toBe(false);
    expect(planIncludesVerified(null, plans)).toBe(false);
  });

  it('only the top plan includes Sponsored', () => {
    expect(planIncludesSponsored(elite, plans)).toBe(true);
    expect(planIncludesSponsored(pro, plans)).toBe(false);
  });

  it('an explicit plan setting wins over the price ranking', () => {
    const b = { ...booking, feature_flags: { includes_verified_addon: true, includes_sponsored_addon: true } };
    const e = { ...elite, feature_flags: { includes_verified_addon: false } };
    expect(planIncludesVerified(b, plans)).toBe(true);
    expect(planIncludesSponsored(b, plans)).toBe(true);
    expect(planIncludesVerified(e, plans)).toBe(false);
  });

  it('Concierge is only for plans that allow or include it', () => {
    expect(planConciergeAvailable(booking)).toBe(false);
    expect(planConciergeAvailable({ ...elite, feature_flags: { addon_concierge_available: true } })).toBe(true);
    expect(planIncludesConcierge({ ...elite, feature_flags: { addon_concierge_included: 'yes' } })).toBe(false);
    expect(planIncludesConcierge({ ...elite, feature_flags: { addon_concierge_included: true } })).toBe(true);
  });
});

describe('monthly total', () => {
  it('is the plan price plus the add-ons the venue chose', () => {
    expect(computeMonthlyTotalCents({ plan: booking, allPlans: plans, addonVerifiedUser: true, addonSponsoredUser: true })).toEqual({
      plan_cents: 9700,
      verified_cents: DEFAULT_ADDON_PRICES.verified_cents,
      sponsored_cents: DEFAULT_ADDON_PRICES.sponsored_cents,
      concierge_cents: 0,
      total_cents: 9700 + DEFAULT_ADDON_PRICES.verified_cents + DEFAULT_ADDON_PRICES.sponsored_cents,
    });
  });

  it('never charges for an add-on the plan already includes', () => {
    const t = computeMonthlyTotalCents({ plan: elite, allPlans: plans, addonVerifiedUser: true, addonSponsoredUser: true });
    expect(t.total_cents).toBe(49700);
    const c = computeMonthlyTotalCents({ plan: { ...elite, feature_flags: { addon_concierge_included: true } }, allPlans: plans, addonVerifiedUser: false, addonSponsoredUser: false, addonConciergeUser: true });
    expect(c.concierge_cents).toBe(0);
  });

  it('charges nothing extra when nothing was chosen', () => {
    expect(computeMonthlyTotalCents({ plan: booking, allPlans: plans, addonVerifiedUser: false, addonSponsoredUser: false }).total_cents).toBe(9700);
    expect(computeMonthlyTotalCents({ plan: null, allPlans: plans, addonVerifiedUser: false, addonSponsoredUser: false }).total_cents).toBe(0);
  });

  it('uses the prices set in the admin panel', () => {
    const prices = { verified_cents: 2500, sponsored_cents: 15000, concierge_cents: 29700 };
    const t = computeMonthlyTotalCents({ plan: booking, allPlans: plans, addonVerifiedUser: true, addonSponsoredUser: false, addonConciergeUser: true, prices });
    expect(t).toMatchObject({ verified_cents: 2500, concierge_cents: 29700, total_cents: 9700 + 2500 + 29700 });
  });

  it('reports where each add-on comes from', () => {
    const e = resolveEffectiveAddons({ plan: elite, allPlans: plans, addonVerifiedUser: false, addonSponsoredUser: true });
    expect(e).toMatchObject({ verified: true, verifiedFromPlan: true, verifiedUser: false, sponsored: true, sponsoredFromPlan: true, sponsoredUser: true, concierge: false });
  });
});
