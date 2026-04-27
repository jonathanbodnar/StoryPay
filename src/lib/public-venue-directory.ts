import { supabaseAdmin } from '@/lib/supabase';
import { isPublicSponsoredStatus, isPublicVerifiedStatus } from '@/lib/directory-badges';
import { isValidGa4MeasurementId } from '@/lib/ga4';
import type { GoogleReviewsCachePayload } from '@/lib/google-place-reviews';
import {
  isGoogleReviewsCacheStale,
  isValidGooglePlaceId,
  parseGoogleReviewsCache,
  refreshVenueGoogleReviews,
} from '@/lib/venue-google-reviews';

export type PublicVenueReviewItem = {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  reviewer_name: string;
  wedding_date: string | null;
  created_at: string;
};

export type PublicGoogleReviewItem = {
  author_name: string;
  rating: number;
  text: string;
  published_at: string | null;
  profile_photo_url: string | null;
};

export type PublicVenueSocialLinks = {
  facebook?: string;
  instagram?: string;
  tiktok?: string;
  pinterest?: string;
  website?: string;
};

export type PublicVenueFaqItem = { question: string; answer: string };

function publicGoogleFromCache(cache: GoogleReviewsCachePayload | null): {
  average_rating: number | null;
  count: number;
  items: PublicGoogleReviewItem[];
} {
  if (!cache) return { average_rating: null, count: 0, items: [] };
  return {
    average_rating: cache.rating,
    count: cache.userRatingCount,
    items: cache.reviews.map((r) => ({
      author_name: r.author_name,
      rating: r.rating,
      text: r.text,
      published_at: r.published_at,
      profile_photo_url: r.profile_photo_url,
    })),
  };
}

export type PublicVenuePayload = {
  venue: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    location_full: string | null;
    location_city: string | null;
    location_state: string | null;
    lat: number | null;
    lng: number | null;
    venue_type: string | null;
    capacity_min: number | null;
    capacity_max: number | null;
    price_min: number | null;
    price_max: number | null;
    indoor_outdoor: string | null;
    features: string[];
    cover_image_url: string | null;
    gallery_images: string[];
    availability_notes: string | null;
    show_map: boolean;
    social_links: PublicVenueSocialLinks;
    faq: PublicVenueFaqItem[];
    /** GA4 web Measurement ID; loaded on public pages when valid. */
    ga4_measurement_id: string | null;
    /** Blue verified badge (admin-approved). */
    listing_verified: boolean;
    /** "Sponsored" label (admin-approved). */
    listing_sponsored: boolean;
    /** Venue's own website URL (brand_website), used on the thank-you page. */
    brand_website: string | null;
  };
  reviews: {
    average_rating: number | null;
    count: number;
    items: PublicVenueReviewItem[];
  };
  /** Present only when the venue connected a Google Place ID. Omit from UI when null. */
  google_reviews: {
    average_rating: number | null;
    count: number;
    items: PublicGoogleReviewItem[];
  } | null;
};

/**
 * Published venue + published listing reviews for directory / embed / public API.
 * Returns null if slug invalid, venue missing, or not published.
 */
export async function getPublicVenueBySlug(rawSlug: string): Promise<PublicVenuePayload | null> {
  const slug = decodeURIComponent(rawSlug || '').trim().toLowerCase();
  if (!slug || slug.length > 120) return null;

  const { data: venue, error: vErr } = await supabaseAdmin
    .from('venues')
    .select(
      [
        'id',
        'name',
        'slug',
        'description',
        'location_full',
        'location_city',
        'location_state',
        'lat',
        'lng',
        'venue_type',
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
        'show_map',
        'social_links',
        'faq',
        'ga4_measurement_id',
        'google_place_id',
        'google_reviews_cache',
        'google_reviews_fetched_at',
        'directory_verified_status',
        'directory_sponsored_status',
        'brand_website',
      ].join(','),
    )
    .eq('slug', slug)
    .maybeSingle();

  if (vErr) {
    console.error('[getPublicVenueBySlug] venue', vErr);
    return null;
  }

  const row = venue as Record<string, unknown> | null;
  if (!row || row.is_published !== true) return null;

  const venueId = String(row.id ?? '');
  if (!venueId) return null;

  let average_rating: number | null = null;
  let review_count = 0;
  const items: PublicVenueReviewItem[] = [];

  const { data: revs, error: rErr } = await supabaseAdmin
    .from('listing_reviews')
    .select('id, rating, title, body, reviewer_name, wedding_date, created_at')
    .eq('venue_id', venueId)
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(80);

  if (rErr) {
    const msg = rErr.message?.toLowerCase() ?? '';
    if (!msg.includes('does not exist') && !msg.includes('42p01')) {
      console.warn('[getPublicVenueBySlug] listing_reviews:', rErr.message);
    }
  } else if (revs?.length) {
    review_count = revs.length;
    const sum = revs.reduce((a, r) => a + Number((r as { rating: number }).rating), 0);
    average_rating = Math.round((sum / revs.length) * 10) / 10;
    for (const r of revs) {
      const x = r as {
        id: string;
        rating: number;
        title: string | null;
        body: string;
        reviewer_name: string;
        wedding_date: string | null;
        created_at: string;
      };
      items.push({
        id: x.id,
        rating: x.rating,
        title: x.title,
        body: x.body,
        reviewer_name: x.reviewer_name,
        wedding_date: x.wedding_date,
        created_at: x.created_at,
      });
    }
  }

  const v = row;

  const latRaw = v.lat != null ? Number(v.lat) : null;
  const lngRaw = v.lng != null ? Number(v.lng) : null;
  const lat = latRaw != null && !Number.isNaN(latRaw) ? latRaw : null;
  const lng = lngRaw != null && !Number.isNaN(lngRaw) ? lngRaw : null;

  const gaRaw = v.ga4_measurement_id != null ? String(v.ga4_measurement_id).trim() : '';
  const ga4_measurement_id = isValidGa4MeasurementId(gaRaw) ? gaRaw : null;

  const verifiedRaw = v.directory_verified_status != null ? String(v.directory_verified_status) : 'none';
  const sponsoredRaw = v.directory_sponsored_status != null ? String(v.directory_sponsored_status) : 'none';
  const listing_verified = isPublicVerifiedStatus(verifiedRaw);
  const listing_sponsored = isPublicSponsoredStatus(sponsoredRaw);

  const socialRaw = v.social_links as Record<string, unknown> | null | undefined;
  const social_links: PublicVenueSocialLinks = {};
  if (socialRaw && typeof socialRaw === 'object' && !Array.isArray(socialRaw)) {
    for (const key of ['facebook', 'instagram', 'tiktok', 'pinterest', 'website'] as const) {
      const u = socialRaw[key];
      if (typeof u === 'string' && u.trim().startsWith('http')) social_links[key] = u.trim();
    }
  }

  let faq: PublicVenueFaqItem[] = [];
  const faqRaw = v.faq;
  if (Array.isArray(faqRaw)) {
    faq = faqRaw
      .filter((x) => x && typeof x === 'object')
      .map((x) => {
        const o = x as { question?: unknown; answer?: unknown };
        return {
          question: String(o.question ?? '').trim(),
          answer: String(o.answer ?? '').trim(),
        };
      })
      .filter((x) => x.question || x.answer)
      .slice(0, 20);
  }

  let google_reviews: PublicVenuePayload['google_reviews'] = null;
  const gPlaceRaw = v.google_place_id != null ? String(v.google_place_id).trim() : '';
  if (gPlaceRaw && isValidGooglePlaceId(gPlaceRaw)) {
    let gCache = parseGoogleReviewsCache(v.google_reviews_cache);
    const fetchedAt =
      v.google_reviews_fetched_at != null ? String(v.google_reviews_fetched_at) : null;
    if (isGoogleReviewsCacheStale(fetchedAt) || !gCache) {
      const fresh = await refreshVenueGoogleReviews(venueId, gPlaceRaw);
      if (fresh) gCache = fresh;
    }
    google_reviews = publicGoogleFromCache(gCache);
  }

  return {
    venue: {
      id: venueId,
      name: String(v.name ?? ''),
      slug: String(v.slug ?? slug),
      description: v.description != null ? String(v.description) : null,
      location_full: v.location_full != null ? String(v.location_full) : null,
      location_city: v.location_city != null ? String(v.location_city) : null,
      location_state: v.location_state != null ? String(v.location_state) : null,
      lat,
      lng,
      venue_type: v.venue_type != null ? String(v.venue_type) : null,
      capacity_min: v.capacity_min != null ? Number(v.capacity_min) : null,
      capacity_max: v.capacity_max != null ? Number(v.capacity_max) : null,
      price_min: v.price_min != null ? Number(v.price_min) : null,
      price_max: v.price_max != null ? Number(v.price_max) : null,
      indoor_outdoor: v.indoor_outdoor != null ? String(v.indoor_outdoor) : null,
      features: Array.isArray(v.features) ? (v.features as string[]) : [],
      cover_image_url: v.cover_image_url != null ? String(v.cover_image_url) : null,
      gallery_images: Array.isArray(v.gallery_images) ? (v.gallery_images as string[]) : [],
      availability_notes: v.availability_notes != null ? String(v.availability_notes) : null,
      show_map: v.show_map === false ? false : true,
      social_links,
      faq,
      ga4_measurement_id,
      listing_verified,
      listing_sponsored,
      brand_website: v.brand_website != null ? String(v.brand_website) : null,
    },
    reviews: {
      average_rating,
      count: review_count,
      items,
    },
    google_reviews,
  };
}
