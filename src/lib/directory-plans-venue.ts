import {
  DIRECTORY_LEGACY_FEATURE_TO_NAV_IDS,
  allDirectoryNavIds,
  defaultNavPermissionsAllTrue,
  navIdsFromLegacyFeatureFlags,
  coarseFeatureFlagsFromNavPermissions,
} from '@/lib/directory-nav-registry';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * When a venue has no directory_plan_id, treat as full access (legacy rows).
 * With a plan: use nav_permissions when non-empty; otherwise legacy feature_flags.
 */
export function venueHasDirectoryFeature(
  featureFlags: Record<string, boolean> | null | undefined,
  featureKey: string,
): boolean {
  if (!featureFlags || typeof featureFlags !== 'object') return false;
  return featureFlags[featureKey] === true;
}

export function venueDirectoryAccessMode(venue: { directory_plan_id: string | null | undefined }): 'legacy_full' | 'plan' {
  return venue.directory_plan_id ? 'plan' : 'legacy_full';
}

function planHasExplicitNavPermissions(navPermissions: unknown): boolean {
  return (
    navPermissions !== null &&
    navPermissions !== undefined &&
    typeof navPermissions === 'object' &&
    Object.keys(navPermissions as object).length > 0
  );
}

/**
 * Implicit sibling pages: if the key on the left is enabled, the values on
 * the right are auto-enabled too. Use this for pages that conceptually
 * depend on each other so admins don't have to remember to flip both, and
 * so plans created before a sibling existed don't lock users out of it.
 */
const IMPLICIT_NAV_SIBLINGS: Record<string, string[]> = {
  // Audiences are created/edited from the Audiences page and then selected
  // inside the Emails composer — anyone with access to Emails should
  // automatically get access to Audiences.
  nav_marketing_email_campaigns: ['nav_marketing_email_segments'],
  // The Media library used to live under Listing; it's now top-level. Plans
  // created before the move only have `nav_listing_media`, so mirror that
  // permission onto the new id so existing plans don't lose access.
  nav_listing_media: ['nav_main_media'],
};

/**
 * Allowed nav ids for a plan row. Always includes `nav_main_home` if any access remains.
 * Empty legacy + empty explicit → home only.
 */
export function computeAllowedNavIdsFromPlan(plan: {
  feature_flags: Record<string, boolean> | null | undefined;
  nav_permissions?: Record<string, boolean> | null | undefined;
}): string[] {
  const explicit = planHasExplicitNavPermissions(plan.nav_permissions);
  let set: Set<string>;

  if (explicit) {
    set = new Set<string>();
    for (const [k, v] of Object.entries(plan.nav_permissions as Record<string, boolean>)) {
      if (v === true) set.add(k);
    }
  } else {
    set = navIdsFromLegacyFeatureFlags(plan.feature_flags);
  }

  // Backward compat: AI Concierge moved from settings → marketing in
  // May 2026. Plans saved before that have `nav_settings_ai_concierge: true`
  // which is no longer in the registry; forward it to its new id so the
  // upgrade is invisible to existing customers.
  if (set.has('nav_settings_ai_concierge')) {
    set.delete('nav_settings_ai_concierge');
    set.add('nav_marketing_ai_concierge');
  }

  if (set.size === 0) {
    return ['nav_main_home'];
  }
  if (!set.has('nav_main_home')) {
    set.add('nav_main_home');
  }

  // Apply implicit sibling expansions (e.g. Emails → Audiences).
  for (const [parent, siblings] of Object.entries(IMPLICIT_NAV_SIBLINGS)) {
    if (set.has(parent)) {
      for (const id of siblings) set.add(id);
    }
  }

  return [...set];
}

export type DirectoryNavAccess =
  | { mode: 'full'; allowedNavIds: null }
  | { mode: 'plan'; allowedNavIds: string[] };

export async function loadDirectoryNavAccess(venueId: string): Promise<DirectoryNavAccess> {
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('directory_plan_id')
    .eq('id', venueId)
    .maybeSingle();

  if (!venue?.directory_plan_id) {
    return { mode: 'full', allowedNavIds: null };
  }

  const { data: plan } = await supabaseAdmin
    .from('directory_plans')
    .select('feature_flags, nav_permissions')
    .eq('id', venue.directory_plan_id)
    .maybeSingle();

  if (!plan) {
    return { mode: 'full', allowedNavIds: null };
  }

  return {
    mode: 'plan',
    allowedNavIds: computeAllowedNavIdsFromPlan({
      feature_flags: plan.feature_flags as Record<string, boolean> | null,
      nav_permissions: plan.nav_permissions as Record<string, boolean> | null,
    }),
  };
}

/** Merge explicit nav checkboxes: full map with every registry id, then overlay saved plan. */
export function mergeNavPermissionsForEditor(
  saved: Record<string, boolean> | null | undefined,
  featureFlags: Record<string, boolean> | null | undefined,
): Record<string, boolean> {
  const base: Record<string, boolean> = Object.fromEntries(allDirectoryNavIds().map((id) => [id, false]));

  if (saved && typeof saved === 'object' && Object.keys(saved).length > 0) {
    for (const id of allDirectoryNavIds()) {
      if (saved[id] === true) base[id] = true;
    }
    return base;
  }

  for (const id of navIdsFromLegacyFeatureFlags(featureFlags)) {
    base[id] = true;
  }
  return base;
}

/** When saving a plan from the nav editor, persist nav_permissions + derived coarse feature_flags. */
export function buildPlanNavPayloadFromEditor(nav: Record<string, boolean>): {
  nav_permissions: Record<string, boolean>;
  feature_flags: Record<string, boolean>;
} {
  const nav_permissions: Record<string, boolean> = {};
  for (const id of allDirectoryNavIds()) {
    nav_permissions[id] = nav[id] === true;
  }
  return {
    nav_permissions,
    feature_flags: coarseFeatureFlagsFromNavPermissions(nav_permissions),
  };
}

export function defaultNavPermissionsForNewPlan(): Record<string, boolean> {
  return defaultNavPermissionsAllTrue();
}

/** If legacy_full, all features allowed. If plan, resolve via nav + legacy. */
export function canAccessDirectoryFeature(
  venue: { directory_plan_id: string | null | undefined },
  plan: {
    feature_flags: Record<string, boolean> | null | undefined;
    nav_permissions?: Record<string, boolean> | null | undefined;
  } | null,
  featureKey: string,
): boolean {
  if (venueDirectoryAccessMode(venue) === 'legacy_full') return true;
  if (!plan) return false;

  const allowed = new Set(computeAllowedNavIdsFromPlan(plan));
  const mapped = DIRECTORY_LEGACY_FEATURE_TO_NAV_IDS[featureKey];
  if (mapped?.length) {
    return mapped.some((id) => allowed.has(id));
  }
  return venueHasDirectoryFeature(plan.feature_flags, featureKey);
}
