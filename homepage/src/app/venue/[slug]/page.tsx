import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { MapPin, Users, DollarSign, Home, Sparkles, Star } from 'lucide-react';
import { Ga4Scripts } from '@/components/Ga4Scripts';
import { SaveToWishlistButton } from '@/components/SaveToWishlistButton';
import { VenueReviewsTabs } from '@/components/VenueReviewsTabs';
import { VenueFaqSection, VenueMapEmbed, VenueSocialRow } from '@/components/VenuePublicExtras';
import { DirectoryListingBadges } from '@/components/DirectoryListingBadges';
import { ListingTracker } from '@/components/ListingTracker';
import { ListingLeadModal } from '@/components/ListingLeadModal';

const API_BASE = process.env.NEXT_PUBLIC_DASHBOARD_URL || 'https://app.storyvenue.com';
const DIRECTORY_SITE =
  process.env.NEXT_PUBLIC_DIRECTORY_SITE_URL || 'https://storyvenue.com';

/**
 * Convert a raw Nominatim display_name into a clean US-style address:
 *   "1090 Ragged Edge Road, Chambersburg, PA 17202"
 */
function formatVenueAddress(
  locationFull: string | null | undefined,
  locationCity: string | null | undefined,
  locationState: string | null | undefined,
): string | null {
  const city  = locationCity?.trim()  || '';
  const state = locationState?.trim() || '';
  const zip   = locationFull?.match(/\b(\d{5})\b/)?.[1] ?? '';

  let street = '';
  if (locationFull) {
    const SKIP = [
      /^united states$/i,
      /^(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming)$/i,
      /^\d{5}(-\d{4})?$/,
      /\b(county|township|parish|borough)\b/i,
    ];
    const parts = locationFull.split(',').map((p) => p.trim()).filter(Boolean);
    const streetParts = parts.filter((p) => {
      if (city && p.toLowerCase() === city.toLowerCase()) return false;
      return !SKIP.some((re) => re.test(p));
    });
    if (streetParts.length >= 2 && /^\d+[a-z]?$/i.test(streetParts[0])) {
      street = `${streetParts[0]} ${streetParts[1]}`;
    } else if (streetParts.length >= 1) {
      street = streetParts[0];
    }
  }

  const line2 = [city, state].filter(Boolean).join(', ') + (zip ? ` ${zip}` : '');
  const parts  = [street, line2].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

type PublicVenuePayload = {
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
    social_links: Record<string, string>;
    faq: { question: string; answer: string }[];
    ga4_measurement_id?: string | null;
    listing_verified?: boolean;
    listing_sponsored?: boolean;
    /**
     * False when the venue's plan does NOT grant the "Pricing Guide" nav
     * permission. The lead-capture sidebar (Get pricing & availability) is
     * skipped entirely in that case so non-marketing tiers can't promote a
     * guide they don't have. Defaults to true when the field is absent so
     * older API responses keep working unchanged.
     */
    pricing_guide_enabled?: boolean;
    /** When true the venue's plan requests the directory listing header be hidden (landing page mode). */
    hide_header?: boolean;
  };
  reviews: {
    average_rating: number | null;
    count: number;
    items: Array<{
      id: string;
      rating: number;
      title: string | null;
      body: string;
      reviewer_name: string;
      wedding_date: string | null;
      created_at: string;
    }>;
  };
  google_reviews: {
    average_rating: number | null;
    count: number;
    items: Array<{
      author_name: string;
      rating: number;
      text: string;
      published_at: string | null;
      profile_photo_url: string | null;
    }>;
  } | null;
};

const fetchVenue = cache(async (slug: string, previewToken?: string | null): Promise<PublicVenuePayload | null> => {
  const url = new URL(`${API_BASE}/api/public/venues/${encodeURIComponent(slug)}`);
  if (previewToken) url.searchParams.set('preview', previewToken);
  const res = await fetch(url.toString(), {
    // Demo venues must not be CDN-cached — the token is the auth mechanism.
    next: previewToken ? { revalidate: 0 } : { revalidate: 120 },
    headers: { Accept: 'application/json' },
  });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return res.json() as Promise<PublicVenuePayload>;
});

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const { slug } = await params;
  const sp = await searchParams;
  const previewToken = typeof sp.preview === 'string' ? sp.preview : null;
  const data = await fetchVenue(slug, previewToken);
  if (!data) {
    return { title: 'Venue', robots: { index: false } };
  }
  const { venue, reviews } = data;
  const loc = [venue.location_city, venue.location_state].filter(Boolean).join(', ');
  const title = loc ? `${venue.name} — ${loc}` : venue.name;
  const desc =
    venue.description?.slice(0, 155) ||
    `Wedding venue${loc ? ` in ${loc}` : ''}.${reviews.count ? ` ${reviews.count} verified reviews.` : ''}`;

  const canonical = `${DIRECTORY_SITE}/venue/${venue.slug}`;

  return {
    metadataBase: new URL(DIRECTORY_SITE),
    title,
    description: desc,
    // Demo venues must never be indexed — the preview token is auth, not content
    ...(previewToken ? { robots: { index: false, follow: false } } : {}),
    alternates: { canonical },
    openGraph: {
      title,
      description: desc,
      url: canonical,
      type: 'website',
      images: venue.cover_image_url ? [{ url: venue.cover_image_url, width: 1200, height: 630 }] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: desc,
    },
  };
}

function Stars({ value, size = 18 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={size}
          className={n <= value ? 'fill-amber-400 text-amber-400' : 'fill-gray-100 text-gray-200'}
          strokeWidth={n <= value ? 0 : 1.2}
        />
      ))}
    </span>
  );
}

export default async function PublicVenuePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const previewToken = typeof sp.preview === 'string' ? sp.preview : null;
  const data = await fetchVenue(slug, previewToken);
  if (!data) notFound();

  const { venue, reviews, google_reviews } = data;
  const listingVerified = venue.listing_verified === true;
  const listingSponsored = venue.listing_sponsored === true;
  const locationLine =
    formatVenueAddress(venue.location_full, venue.location_city, venue.location_state) ||
    [venue.location_city, venue.location_state].filter(Boolean).join(', ') ||
    null;

  const roundedAvg = reviews.average_rating != null ? Math.round(reviews.average_rating * 10) / 10 : null;

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: venue.name,
    url: `${DIRECTORY_SITE}/venue/${venue.slug}`,
    ...(venue.cover_image_url ? { image: venue.cover_image_url } : {}),
    ...(locationLine
      ? {
          address: {
            '@type':         'PostalAddress',
            streetAddress:   (() => {
              const zip = venue.location_full?.match(/\b(\d{5})\b/)?.[1] ?? '';
              const SKIP = [/^united states$/i, /^\d{5}(-\d{4})?$/, /\b(county|township|parish|borough)\b/i, /^(pennsylvania|california|new york|texas|florida|georgia|ohio|michigan|virginia|washington|massachusetts|illinois|arizona|colorado|indiana|tennessee|maryland|north carolina|south carolina|minnesota|wisconsin|missouri|alabama|louisiana|kentucky|oregon|oklahoma|connecticut|iowa|mississippi|arkansas|kansas|utah|nevada|nebraska|new mexico|idaho|west virginia|hawaii|new hampshire|maine|montana|rhode island|delaware|south dakota|north dakota|alaska|vermont|wyoming)$/i];
              const city = venue.location_city?.trim() || '';
              const parts = (venue.location_full || '').split(',').map(p => p.trim()).filter(p => p && !(city && p.toLowerCase() === city.toLowerCase()) && !SKIP.some(r => r.test(p)));
              return parts.length >= 2 && /^\d+[a-z]?$/i.test(parts[0]) ? `${parts[0]} ${parts[1]}` : parts[0] || '';
            })(),
            addressLocality:  venue.location_city  || undefined,
            addressRegion:    venue.location_state || undefined,
            postalCode:       venue.location_full?.match(/\b(\d{5})\b/)?.[1] || undefined,
            addressCountry:   'US',
          },
        }
      : {}),
    ...(reviews.count > 0 && roundedAvg != null
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: roundedAvg,
            reviewCount: reviews.count,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
    ...(reviews.items.length > 0
      ? {
          review: reviews.items.slice(0, 24).map((r) => ({
            '@type': 'Review',
            author: { '@type': 'Person', name: r.reviewer_name },
            reviewRating: {
              '@type': 'Rating',
              ratingValue: r.rating,
              bestRating: 5,
              worstRating: 1,
            },
            reviewBody: r.body,
            datePublished: r.created_at,
          })),
        }
      : {}),
  };

  return (
    <>
      <Ga4Scripts measurementId={venue.ga4_measurement_id} />
      {venue.id && <ListingTracker venueId={venue.id} />}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="min-h-screen bg-[#fafaf9]">
        {!venue.hide_header && (
          <header className="border-b border-gray-200/80 bg-white/90 backdrop-blur-sm">
            <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
              <Link
                href="/"
                className="text-sm font-semibold tracking-wide text-[#1b1b1b] hover:opacity-80"
                style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
              >
                StoryVenue
              </Link>
            </div>
          </header>
        )}

        <section className="relative">
          {venue.cover_image_url ? (
            <div className="relative h-[min(52vh,520px)] w-full overflow-hidden bg-gray-200">
              <Image
                src={venue.cover_image_url}
                alt=""
                fill
                priority
                className="object-cover"
                sizes="100vw"
                unoptimized
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 px-4 pb-10 sm:px-8">
                <div className="mx-auto max-w-5xl">
                  <p
                    className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/80"
                    style={{ fontFamily: 'var(--font-body)' }}
                  >
                    Wedding venue
                  </p>
                  <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
                    <h1
                      className="text-4xl font-semibold tracking-tight text-white sm:text-5xl"
                      style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
                    >
                      {venue.name}
                    </h1>
                    <DirectoryListingBadges
                      verified={listingVerified}
                      sponsored={listingSponsored}
                      variant="onDark"
                    />
                  </div>
                  {locationLine && (
                    <p className="mt-3 flex items-center gap-2 text-sm text-white/90">
                      <MapPin size={16} className="shrink-0 opacity-90" />
                      {locationLine}
                    </p>
                  )}
                  {reviews.count > 0 && roundedAvg != null && (
                    <div className="mt-5 inline-flex items-center gap-3 rounded-2xl bg-white/15 px-4 py-2.5 backdrop-blur-md">
                      <Stars value={Math.round(roundedAvg)} size={20} />
                      <span className="text-sm font-semibold text-white">
                        {roundedAvg} <span className="font-normal text-white/80">· {reviews.count} reviews</span>
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="border-b border-gray-200 bg-gradient-to-br from-[#f5f2ed] to-[#e8eef5] px-4 py-14 sm:px-8 sm:py-20">
              <div className="mx-auto max-w-5xl">
                <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
                  <h1
                    className="text-4xl font-semibold tracking-tight text-gray-900 sm:text-5xl"
                    style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
                  >
                    {venue.name}
                  </h1>
                  <DirectoryListingBadges
                    verified={listingVerified}
                    sponsored={listingSponsored}
                    variant="onLight"
                  />
                </div>
                {locationLine && (
                  <p className="mt-3 flex items-center gap-2 text-gray-600">
                    <MapPin size={18} />
                    {locationLine}
                  </p>
                )}
              </div>
            </div>
          )}
        </section>

        <div className="mx-auto max-w-5xl space-y-12 px-4 py-12 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-[1fr_320px]">
            <div className="space-y-8">
              {venue.description && (
                <div>
                  <h2
                    className="mb-3 text-xl text-gray-900"
                    style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
                  >
                    About
                  </h2>
                  <div className="prose prose-gray max-w-none text-[15px] leading-relaxed text-gray-600">
                    {venue.description.split(/\n\n+/).map((p, i) => (
                      <p key={i} className="mb-4 last:mb-0">
                        {p}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              <SaveToWishlistButton venueSlug={venue.slug} />

              <VenueMapEmbed
                lat={venue.lat ?? null}
                lng={venue.lng ?? null}
                show={venue.show_map !== false}
              />
              <VenueSocialRow social={venue.social_links ?? {}} />
              <VenueFaqSection items={Array.isArray(venue.faq) ? venue.faq : []} />

              {venue.features.length > 0 && (
                <div>
                  <h2
                    className="mb-4 flex items-center gap-2 text-xl text-gray-900"
                    style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
                  >
                    <Sparkles size={20} className="text-amber-600/90" />
                    Highlights
                  </h2>
                  <ul className="flex flex-wrap gap-2">
                    {venue.features.map((f) => (
                      <li
                        key={f}
                        className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700"
                      >
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {venue.gallery_images.length > 0 && (
                <div>
                  <h2
                    className="mb-4 text-xl text-gray-900"
                    style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
                  >
                    Gallery
                  </h2>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
                    {venue.gallery_images.slice(0, 9).map((url, i) => (
                      <div
                        key={i}
                        className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-gray-200 bg-gray-200"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <aside className="space-y-6 lg:pt-2">
              {/* Lead-capture CTA — only rendered for plans that grant the
                  "Pricing Guide" nav permission (marketing tiers). When the
                  box is unchecked in super admin we hide the entire card;
                  the rest of the listing page stays unchanged. Falsy /
                  undefined defaults to enabled to preserve legacy
                  behaviour for older API payloads. */}
              {venue.pricing_guide_enabled !== false && (
                <div className="rounded-3xl border border-gray-200 bg-white p-6">
                  <p className="mb-4 text-sm text-gray-600 leading-relaxed">
                    Get pricing, check availability, and download the full venue guide.
                  </p>
                  <ListingLeadModal
                    venueName={venue.name}
                    venueId={venue.id}
                    venueSlug={venue.slug}
                    apiBase={API_BASE}
                  />
                </div>
              )}

              <div className="rounded-3xl border border-gray-200 bg-white p-6">
                <h3 className="text-xs font-bold uppercase tracking-wide text-gray-400">Details</h3>
                <dl className="mt-4 space-y-4 text-sm">
                  {(venue.capacity_min != null || venue.capacity_max != null) && (
                    <div className="flex gap-3">
                      <Users size={18} className="mt-0.5 shrink-0 text-gray-400" />
                      <div>
                        <dt className="font-medium text-gray-900">Guest count</dt>
                        <dd className="text-gray-600">
                          {venue.capacity_min != null && venue.capacity_max != null
                            ? `${venue.capacity_min}–${venue.capacity_max}`
                            : venue.capacity_max != null
                              ? `Up to ${venue.capacity_max}`
                              : `${venue.capacity_min}+`}
                        </dd>
                      </div>
                    </div>
                  )}
                  {(venue.price_min != null || venue.price_max != null) && (
                    <div className="flex gap-3">
                      <DollarSign size={18} className="mt-0.5 shrink-0 text-gray-400" />
                      <div>
                        <dt className="font-medium text-gray-900">Starting price</dt>
                        <dd className="text-gray-600">
                          {venue.price_min != null && venue.price_max != null
                            ? `$${venue.price_min.toLocaleString()} – $${venue.price_max.toLocaleString()}`
                            : venue.price_min != null
                              ? `From $${venue.price_min.toLocaleString()}`
                              : `Up to $${venue.price_max?.toLocaleString()}`}
                        </dd>
                      </div>
                    </div>
                  )}
                  {venue.indoor_outdoor && (
                    <div className="flex gap-3">
                      <Home size={18} className="mt-0.5 shrink-0 text-gray-400" />
                      <div>
                        <dt className="font-medium text-gray-900">Setting</dt>
                        <dd className="capitalize text-gray-600">{venue.indoor_outdoor.replace(/_/g, ' ')}</dd>
                      </div>
                    </div>
                  )}
                  {venue.venue_type && (
                    <div>
                      <dt className="font-medium text-gray-900">Style</dt>
                      <dd className="capitalize text-gray-600">{venue.venue_type.replace(/-/g, ' ')}</dd>
                    </div>
                  )}
                </dl>
                {venue.availability_notes && (
                  <p className="mt-4 border-t border-gray-100 pt-4 text-xs leading-relaxed text-gray-500">
                    {venue.availability_notes}
                  </p>
                )}
              </div>
            </aside>
          </div>

          <VenueReviewsTabs venueName={venue.name} storyVenue={reviews} google={google_reviews} />
        </div>

        <footer className="border-t border-gray-200 bg-white py-10 text-center text-xs text-gray-400">
          <Link href="/" className="font-medium text-gray-600 hover:text-gray-900">
            StoryVenue
          </Link>
          <span className="mx-2">·</span>
          <span>Listings powered by StoryPay</span>
        </footer>
      </div>
    </>
  );
}
