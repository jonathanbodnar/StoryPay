/**
 * Plan-based feature access — single source of truth for SMS + Concierge gating.
 *
 * Two derived flags drive every gate in the app:
 *
 *   hasSms       — can this venue use SMS features at all?
 *                  true  → plan slug contains "all-inclusive", OR legacy plan,
 *                          OR no plan at all (grandfathered legacy_full rows)
 *                  false → bride-booking-system, free, or any non-all-inclusive
 *                          plan. These accounts never have A2P carrier
 *                          registration, so SMS can never be sent.
 *
 *   hasConcierge — can this venue use the AI Venue Concierge, and should their
 *                  bride replies be routed to the super-admin concierge inbox?
 *                  true  → concierge add-on purchased (directory_addon_concierge),
 *                          OR plan bundles it (feature_flags.addon_concierge_included),
 *                          OR legacy plan / no plan (all add-ons included).
 *
 * IMPORTANT: legacy plans and no-plan (grandfathered) venues get everything —
 * some legacy customers paid for SMS + Concierge and must keep working.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { planIncludesConcierge } from '@/lib/directory-addons';

export interface VenueFeatureRow {
  directory_plan_id?: string | null;
  directory_addon_concierge?: boolean | null;
}

export interface PlanFeatureRow {
  slug?: string | null;
  name?: string | null;
  is_legacy?: boolean | null;
  feature_flags?: Record<string, unknown> | null;
}

export interface VenueFeatureAccess {
  /** Can send / receive SMS (plan includes it). */
  hasSms: boolean;
  /** AI Concierge feature available (add-on purchased/bundled or legacy) +
   *  bride replies routed to the super-admin concierge inbox. */
  hasConcierge: boolean;
  /** Can message the StoryVenue Concierge team from Conversations. This is a
   *  plan-tier feature (any All-Inclusive plan, or legacy) — NOT the concierge
   *  add-on. $97 / free plans get Contact Support but not concierge messaging. */
  canMessageConcierge: boolean;
  /** Legacy / grandfathered plan — gets all add-ons. */
  isLegacy: boolean;
  /** Resolved plan slug (lowercase) or null when the venue has no plan. */
  planSlug: string | null;
}

export const VENUE_FEATURE_COLUMNS = 'directory_plan_id, directory_addon_concierge';
export const PLAN_FEATURE_COLUMNS  = 'slug, name, is_legacy, feature_flags';

function isLegacyPlan(plan: PlanFeatureRow | null): boolean {
  if (!plan) return false;
  return (
    plan.is_legacy === true ||
    String(plan.name ?? '').toLowerCase().includes('legacy') ||
    String(plan.slug ?? '').toLowerCase().includes('legacy')
  );
}

/**
 * Resolve SMS + Concierge access from already-loaded venue + plan rows.
 * Pure function — no DB calls, safe to use anywhere you already have the data.
 */
export function resolveVenueFeatureAccess(
  venue: VenueFeatureRow | null,
  plan: PlanFeatureRow | null,
): VenueFeatureAccess {
  // No plan row at all → grandfathered legacy_full account, gets everything.
  const noPlan = !venue?.directory_plan_id;
  const legacy = noPlan || isLegacyPlan(plan);

  const slug = String(plan?.slug ?? '').toLowerCase() || null;
  const isAllInclusive = slug ? slug.includes('all-inclusive') : false;

  const conciergeBundled  = planIncludesConcierge(plan ? { id: 'x', feature_flags: plan.feature_flags } : null);
  const conciergePurchased = venue?.directory_addon_concierge === true;

  return {
    hasSms:              legacy || isAllInclusive,
    hasConcierge:        legacy || conciergeBundled || conciergePurchased,
    canMessageConcierge: legacy || isAllInclusive,
    isLegacy:            legacy,
    planSlug:            slug,
  };
}

/**
 * Load a venue's SMS + Concierge access from the database.
 * One venue read plus (when the venue has a plan) one plan read.
 */
export async function loadVenueFeatureAccess(venueId: string): Promise<VenueFeatureAccess> {
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select(VENUE_FEATURE_COLUMNS)
    .eq('id', venueId)
    .maybeSingle();

  if (!venue) {
    // Unknown venue — safest default is no access to gated features.
    return { hasSms: false, hasConcierge: false, canMessageConcierge: false, isLegacy: false, planSlug: null };
  }

  const v = venue as VenueFeatureRow;

  let plan: PlanFeatureRow | null = null;
  if (v.directory_plan_id) {
    const { data: planRow } = await supabaseAdmin
      .from('directory_plans')
      .select(PLAN_FEATURE_COLUMNS)
      .eq('id', v.directory_plan_id)
      .maybeSingle();
    plan = (planRow as PlanFeatureRow | null) ?? null;
  }

  return resolveVenueFeatureAccess(v, plan);
}

/**
 * Given a set of venue IDs, return the subset whose bride replies should be
 * routed to the super-admin concierge inbox (i.e. hasConcierge === true).
 * Used to filter the global bride inbox down to concierge-managed venues.
 */
export async function filterConciergeManagedVenueIds(venueIds: string[]): Promise<Set<string>> {
  const managed = new Set<string>();
  if (venueIds.length === 0) return managed;

  const uniqueIds = Array.from(new Set(venueIds));
  const { data: venues } = await supabaseAdmin
    .from('venues')
    .select(`id, ${VENUE_FEATURE_COLUMNS}`)
    .in('id', uniqueIds);

  const venueRows = (venues ?? []) as Array<VenueFeatureRow & { id: string }>;

  // Batch-load the distinct plans referenced by these venues.
  const planIds = Array.from(
    new Set(venueRows.map(v => v.directory_plan_id).filter((x): x is string => Boolean(x))),
  );
  const plansById = new Map<string, PlanFeatureRow>();
  if (planIds.length) {
    const { data: plans } = await supabaseAdmin
      .from('directory_plans')
      .select(`id, ${PLAN_FEATURE_COLUMNS}`)
      .in('id', planIds);
    for (const p of (plans ?? []) as Array<PlanFeatureRow & { id: string }>) {
      plansById.set(p.id, p);
    }
  }

  for (const v of venueRows) {
    const plan = v.directory_plan_id ? plansById.get(v.directory_plan_id) ?? null : null;
    if (resolveVenueFeatureAccess(v, plan).hasConcierge) managed.add(v.id);
  }
  return managed;
}
