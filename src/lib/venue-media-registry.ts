import { supabaseAdmin } from '@/lib/supabase';
import { VENUE_IMAGES_BUCKET } from '@/lib/venue-images-bucket';

/**
 * Server-side helper for inserting (or refreshing) a row in
 * `public.venue_media_assets` so any file uploaded through the dashboard ends
 * up visible in the shared Media library, regardless of which feature
 * triggered the upload (branding logo, listing photos, email/form image
 * picker, etc.).
 *
 * Uses an upsert on `(venue_id, storage_path)` so re-uploads (e.g. replacing a
 * brand logo) refresh the existing row instead of failing on the unique
 * constraint.
 */
export interface RegisterVenueMediaAssetInput {
  venueId: string;
  path: string;
  publicUrl: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  /** Defaults to the shared `venue-images` bucket. */
  sourceBucket?: string;
  /** Optional friendly label shown in the library (falls back to fileName). */
  displayName?: string | null;
}

export async function registerVenueMediaAsset(
  input: RegisterVenueMediaAssetInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sourceBucket = input.sourceBucket ?? VENUE_IMAGES_BUCKET;

  const { error } = await supabaseAdmin
    .from('venue_media_assets')
    .upsert(
      {
        venue_id: input.venueId,
        storage_path: input.path,
        public_url: input.publicUrl,
        file_name: input.fileName,
        content_type: input.contentType,
        size_bytes: input.sizeBytes,
        source_bucket: sourceBucket,
        display_name: input.displayName ?? null,
      },
      { onConflict: 'venue_id,storage_path' },
    );

  if (error) {
    console.warn('[venue-media-registry] upsert failed:', error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * Removes any prior media-library rows whose storage_path falls under
 * `pathPrefix` for the venue. Used by features that overwrite a single
 * canonical file (e.g. the brand logo always uploads to
 * `venue-logos/<venueId>/logo.<ext>`) so a new upload with a different
 * extension doesn't leave behind a stale library entry.
 */
export async function clearVenueMediaAssetsByPrefix(
  venueId: string,
  sourceBucket: string,
  pathPrefix: string,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('venue_media_assets')
    .delete()
    .eq('venue_id', venueId)
    .eq('source_bucket', sourceBucket)
    .like('storage_path', `${pathPrefix}%`);
  if (error) {
    console.warn('[venue-media-registry] cleanup failed:', error.message);
  }
}
