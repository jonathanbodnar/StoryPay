import { supabaseAdmin } from '@/lib/supabase';

export const DIRECTORY_BADGE_STATUSES = ['none', 'draft', 'pending', 'approved', 'rejected'] as const;
export type DirectoryBadgeStatus = (typeof DIRECTORY_BADGE_STATUSES)[number];

export function isDirectoryBadgeStatus(v: string | null | undefined): v is DirectoryBadgeStatus {
  return DIRECTORY_BADGE_STATUSES.includes(v as DirectoryBadgeStatus);
}

/**
 * Auto-enables the Verified badge for a venue that has both:
 *   1. A Google Business Profile connected (google_place_id populated), AND
 *   2. A card on file (called after the card-vault step completes).
 *
 * Only promotes 'none' or 'draft' → 'approved'. Leaves 'pending', 'approved',
 * and 'rejected' untouched so super-admin manual decisions are never overridden.
 * Non-fatal: errors are logged but never thrown.
 */
export async function autoVerifyGbpVenue(venueId: string): Promise<void> {
  try {
    const { data: row, error } = await supabaseAdmin
      .from('venues')
      .select('google_place_id, directory_verified_status')
      .eq('id', venueId)
      .maybeSingle();

    if (error) {
      console.warn('[autoVerifyGbpVenue] fetch error:', error.message, { venueId });
      return;
    }
    if (!row) return;

    const placeId = typeof row.google_place_id === 'string' ? row.google_place_id.trim() : '';
    const currentStatus = typeof row.directory_verified_status === 'string'
      ? row.directory_verified_status
      : 'none';

    if (!placeId) return; // No GBP connected — nothing to do.

    // Only auto-promote if no admin decision has been recorded yet.
    if (currentStatus !== 'none' && currentStatus !== 'draft') return;

    const { error: upErr } = await supabaseAdmin
      .from('venues')
      .update({ directory_verified_status: 'approved' })
      .eq('id', venueId);

    if (upErr) {
      console.warn('[autoVerifyGbpVenue] update error:', upErr.message, { venueId });
    } else {
      console.log('[autoVerifyGbpVenue] auto-verified venue via GBP:', venueId);
    }
  } catch (err) {
    console.warn('[autoVerifyGbpVenue] unexpected error:', err, { venueId });
  }
}

/** Public directory / API: show Instagram-style verified badge */
export function isPublicVerifiedStatus(status: string | null | undefined): boolean {
  return status === 'approved';
}

/** Public directory / API: show "Sponsored" label */
export function isPublicSponsoredStatus(status: string | null | undefined): boolean {
  return status === 'approved';
}

export function directoryBadgeLabel(status: string): string {
  switch (status) {
    case 'none':
      return 'None';
    case 'draft':
      return 'Draft';
    case 'pending':
      return 'Pending';
    case 'approved':
      return 'Approved (live)';
    case 'rejected':
      return 'Rejected';
    default:
      return status;
  }
}
