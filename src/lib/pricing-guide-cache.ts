/**
 * Utilities for the Supabase Storage cache of generated pricing-guide PDFs.
 *
 * Bucket: pricing-guides (public)
 * Path:   {venueId}/pricing-guide.pdf
 *
 * Every write/delete route that changes the data rendered into the PDF should
 * call `invalidatePricingGuidePdfCache` so the next public request triggers
 * a fresh generation.
 */

import { supabaseAdmin } from '@/lib/supabase';

export const PRICING_GUIDES_BUCKET = 'pricing-guides';

let bucketEnsured = false;

/**
 * Creates the `pricing-guides` bucket if it does not already exist.
 * Safe to call on every request — short-circuits after the first success.
 */
export async function ensurePricingGuidesBucket(): Promise<void> {
  if (bucketEnsured) return;
  try {
    await supabaseAdmin.storage.createBucket(PRICING_GUIDES_BUCKET, { public: true });
  } catch {
    // Bucket already exists — that is fine.
  }
  bucketEnsured = true;
}

/**
 * Deletes the cached PDF for a venue so the next request regenerates it.
 * Best-effort — never throws.
 */
export async function invalidatePricingGuidePdfCache(venueId: string): Promise<void> {
  await supabaseAdmin.storage
    .from(PRICING_GUIDES_BUCKET)
    .remove([`${venueId}/pricing-guide.pdf`])
    .catch(() => {});
}
