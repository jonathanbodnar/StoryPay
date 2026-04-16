/**
 * Shared helpers for the directory integration.
 *
 * There is no separate `venue_listings` table. The `public.venues` row IS the
 * directory listing — it already carries all the directory-facing fields
 * (slug, location, capacity, features, cover_image_url, gallery_images,
 * is_published, notification_email, …) alongside the StoryPay-internal ones
 * (brand_*, lunarpay_*, onboarding_*, etc.). The dashboard PATCH endpoint
 * writes through this allow-list so a venue owner can never touch an internal
 * column.
 */

export const LISTING_WRITABLE_FIELDS = [
  'slug',
  'name',
  'description',
  'venue_type',
  'location_full',
  'location_city',
  'location_state',
  'lat',
  'lng',
  'capacity_min',
  'capacity_max',
  'price_min',
  'price_max',
  'indoor_outdoor',
  'features',
  'cover_image_url',
  'gallery_images',
  'availability_notes',
  'is_published',
  'notification_email',
  'email_notifications',
] as const;

export type ListingWritableField = (typeof LISTING_WRITABLE_FIELDS)[number];

/**
 * The directory-facing projection of a `venues` row. API responses use this
 * shape so the frontend never sees internal StoryPay columns.
 */
export const LISTING_READABLE_FIELDS = [
  'id',
  ...LISTING_WRITABLE_FIELDS,
  'onboarding_completed',
  'is_published',
  'created_at',
  'updated_at',
] as const;

/**
 * Convert an arbitrary name into a URL-safe slug.
 * "The Maple Barn (Ohio)" -> "the-maple-barn-ohio".
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}
