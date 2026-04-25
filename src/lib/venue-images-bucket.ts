import { supabaseAdmin } from '@/lib/supabase';

export const VENUE_IMAGES_BUCKET = 'venue-images';
export const VENUE_MEDIA_PREFIX = 'media';

/** Max upload size for listing + media library (matches bucket config). */
export const VENUE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
/** Larger cap for documents (PDFs / spreadsheets / etc.) */
export const VENUE_FILE_MAX_BYTES = 25 * 1024 * 1024;

export const VENUE_IMAGE_ALLOWED_MIME = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
] as const;

/** Document/file MIME types allowed alongside images for the media library. */
export const VENUE_FILE_ALLOWED_MIME = [
  // PDFs
  'application/pdf',
  // Word
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  // Excel
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // PowerPoint
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Plain text / CSV
  'text/plain',
  'text/csv',
  // Google Docs/Sheets exported as office formats fall under the above types
] as const;

export const VENUE_MEDIA_ALLOWED_MIME = [
  ...VENUE_IMAGE_ALLOWED_MIME,
  ...VENUE_FILE_ALLOWED_MIME,
] as const;

let bucketEnsured = false;

export async function ensureVenueImagesBucket(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (bucketEnsured) return { ok: true };

  const { data: buckets, error: listErr } = await supabaseAdmin.storage.listBuckets();
  if (listErr) return { ok: false, error: `listBuckets: ${listErr.message}` };

  const exists = (buckets ?? []).some((b) => b.name === VENUE_IMAGES_BUCKET);
  if (exists) {
    // Bucket may have been created earlier with image-only restrictions; widen
    // it to accept documents too. Failures here are non-fatal — the bucket may
    // already be permissive, in which case Supabase still returns 200.
    const { error: updErr } = await supabaseAdmin.storage.updateBucket(VENUE_IMAGES_BUCKET, {
      public: true,
      fileSizeLimit: VENUE_FILE_MAX_BYTES,
      allowedMimeTypes: [...VENUE_MEDIA_ALLOWED_MIME],
    });
    if (updErr) {
      console.warn('[venue-images-bucket] updateBucket warning:', updErr.message);
    }
    bucketEnsured = true;
    return { ok: true };
  }

  const { error: createErr } = await supabaseAdmin.storage.createBucket(VENUE_IMAGES_BUCKET, {
    public: true,
    fileSizeLimit: VENUE_FILE_MAX_BYTES,
    allowedMimeTypes: [...VENUE_MEDIA_ALLOWED_MIME],
  });
  if (createErr && !/already exists/i.test(createErr.message)) {
    return { ok: false, error: `createBucket: ${createErr.message}` };
  }

  bucketEnsured = true;
  return { ok: true };
}

export function isVideoContentType(contentType: string): boolean {
  return contentType.toLowerCase().startsWith('video/');
}

export function isImageContentType(contentType: string): boolean {
  return contentType.toLowerCase().startsWith('image/');
}

/** Legacy: accepts only image MIME types. Used by listing image uploads. */
export function validateVenueImageUpload(contentType: string, size: number): string | null {
  const ct = contentType.toLowerCase();
  if (isVideoContentType(ct)) {
    return 'Video uploads are not supported. Use images only.';
  }
  if (!ct.startsWith('image/')) {
    return 'Only image files are allowed.';
  }
  if (!VENUE_IMAGE_ALLOWED_MIME.includes(ct as (typeof VENUE_IMAGE_ALLOWED_MIME)[number])) {
    return `Unsupported image type: ${contentType}`;
  }
  if (size > VENUE_IMAGE_MAX_BYTES) {
    return `File exceeds ${VENUE_IMAGE_MAX_BYTES} bytes`;
  }
  return null;
}

/** Allows images plus PDFs/Word/Excel/PowerPoint/CSV/text for the media library. */
export function validateVenueMediaUpload(contentType: string, size: number): string | null {
  const ct = contentType.toLowerCase();
  if (isVideoContentType(ct)) {
    return 'Video uploads are not supported.';
  }
  if (!VENUE_MEDIA_ALLOWED_MIME.includes(ct as (typeof VENUE_MEDIA_ALLOWED_MIME)[number])) {
    return `Unsupported file type: ${contentType}`;
  }
  if (size > VENUE_FILE_MAX_BYTES) {
    return `File exceeds ${Math.round(VENUE_FILE_MAX_BYTES / (1024 * 1024))}MB limit`;
  }
  return null;
}

export function mediaLibraryObjectKey(venueId: string, fileName: string): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  return `${venueId}/${VENUE_MEDIA_PREFIX}/${id}-${safe}`;
}

export function isMediaLibraryPath(venueId: string, storagePath: string): boolean {
  return storagePath.startsWith(`${venueId}/${VENUE_MEDIA_PREFIX}/`);
}
