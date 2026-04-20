/**
 * When a venue has no directory_plan_id, treat as full access (legacy rows).
 * Once a plan is assigned, use its feature_flags (boolean map by feature_key).
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

/** If legacy_full, all features allowed. If plan, check flag. */
export function canAccessDirectoryFeature(
  venue: { directory_plan_id: string | null | undefined },
  planFlags: Record<string, boolean> | null | undefined,
  featureKey: string,
): boolean {
  if (venueDirectoryAccessMode(venue) === 'legacy_full') return true;
  return venueHasDirectoryFeature(planFlags, featureKey);
}
