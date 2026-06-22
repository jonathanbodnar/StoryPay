/**
 * Venue storage quota helpers.
 *
 * Limits:
 *  - Free plan (no paid plan): 250 MB
 *  - Paid plans: 2 GB
 *  - Per-file: 50 MB (enforced by upload endpoints)
 *
 * Count-based limits (enforced by individual endpoints):
 *  - Gallery listing photos: 25
 *  - Pricing-guide photos per space: 12
 *  - Email media library: 50 files total
 *  - Lead attachments: 5 files per lead
 *
 * Usage is tracked in `public.venue_media_assets` (size_bytes column).
 */

import { supabaseAdmin } from '@/lib/supabase';

export const FREE_QUOTA_BYTES  = 250 * 1024 * 1024;        // 250 MB
export const PAID_QUOTA_BYTES  = 2  * 1024 * 1024 * 1024;  // 2 GB
export const PER_FILE_MAX_BYTES = 50 * 1024 * 1024;         // 50 MB
export const WARN_THRESHOLD    = 0.80;                       // 80%

export interface QuotaStatus {
  usageBytes:  number;
  limitBytes:  number;
  percentUsed: number;
  nearLimit:   boolean;  // ≥ 80%
  atLimit:     boolean;  // ≥ 100%
  freePlan:    boolean;
}

/** Determine whether the venue is on a paid plan. */
async function isFreePlan(venueId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('venues')
    .select('directory_plan_id')
    .eq('id', venueId)
    .maybeSingle();

  const planId = (data as { directory_plan_id: string | null } | null)?.directory_plan_id;
  if (!planId) return true;

  const { data: plan } = await supabaseAdmin
    .from('directory_plans')
    .select('price_monthly_cents')
    .eq('id', planId)
    .maybeSingle();

  const price = (plan as { price_monthly_cents: number | null } | null)?.price_monthly_cents ?? 0;
  return price <= 0;
}

/** Current total storage used by the venue across all assets. */
export async function getVenueStorageUsage(venueId: string): Promise<QuotaStatus> {
  const [usageResult, freePlan] = await Promise.all([
    supabaseAdmin
      .from('venue_media_assets')
      .select('size_bytes')
      .eq('venue_id', venueId),
    isFreePlan(venueId),
  ]);

  const rows = (usageResult.data ?? []) as Array<{ size_bytes: number | null }>;
  const usageBytes = rows.reduce((sum, r) => sum + (r.size_bytes ?? 0), 0);
  const limitBytes = freePlan ? FREE_QUOTA_BYTES : PAID_QUOTA_BYTES;
  const percentUsed = limitBytes > 0 ? usageBytes / limitBytes : 1;

  return {
    usageBytes,
    limitBytes,
    percentUsed,
    nearLimit:  percentUsed >= WARN_THRESHOLD,
    atLimit:    percentUsed >= 1,
    freePlan,
  };
}

/**
 * Check if a new upload of `fileSizeBytes` would exceed the quota.
 * Returns null if allowed, or an error message if not.
 */
export async function checkUploadQuota(
  venueId:       string,
  fileSizeBytes: number,
): Promise<string | null> {
  if (fileSizeBytes > PER_FILE_MAX_BYTES) {
    return `File exceeds the 50 MB per-file limit. Please compress or reduce the file size and try again.`;
  }

  const status = await getVenueStorageUsage(venueId);
  const projectedBytes = status.usageBytes + fileSizeBytes;

  if (projectedBytes > status.limitBytes) {
    const usedMB  = (status.usageBytes  / (1024 * 1024)).toFixed(0);
    const limitMB = status.freePlan ? '250 MB' : '2 GB';
    return `Storage limit reached (${usedMB} MB used of ${limitMB}). Please contact support or upgrade your plan to upload more files.`;
  }

  return null;
}

/** Friendly human-readable size string. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
