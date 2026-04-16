/**
 * Shared types and helpers for the directory integration.
 *
 * - `VenueListing` matches the `venue_listings` table schema in the shared
 *   Supabase project (see src/app/api/admin/setup-directory-db/route.ts).
 * - `listingFieldsForUpdate` is the allow-list of columns the dashboard PATCH
 *   endpoint can write (keeps `id`, `storypay_venue_id`, `created_at` out of
 *   user reach).
 */

export interface VenueListing {
  id: string;
  storypay_venue_id: string;
  slug: string | null;
  name: string | null;
  description: string | null;
  venue_type: string | null;
  location_full: string | null;
  location_city: string | null;
  location_state: string | null;
  lat: number | null;
  lng: number | null;
  capacity_min: number | null;
  capacity_max: number | null;
  price_min: number | null;
  price_max: number | null;
  indoor_outdoor: string | null;
  features: string[];
  cover_image_url: string | null;
  gallery_images: string[];
  availability_notes: string | null;
  is_published: boolean;
  onboarding_completed: boolean;
  notification_email: string | null;
  email_notifications: boolean;
  created_at: string;
  updated_at: string;
}

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
  'onboarding_completed',
  'notification_email',
  'email_notifications',
] as const;

export type ListingWritableField = (typeof LISTING_WRITABLE_FIELDS)[number];

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
