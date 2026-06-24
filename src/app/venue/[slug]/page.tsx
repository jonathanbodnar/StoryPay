import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { MapPin, Sparkles } from 'lucide-react';
import { getPublicVenueBySlug } from '@/lib/public-venue-directory';
import { ListingReviewsBlock } from '@/components/directory/ListingReviewsBlock';
import { DirectoryListingBadges } from '@/components/directory/DirectoryListingBadges';
import { Ga4Scripts } from '@/components/directory/Ga4Scripts';
import { VenueFaqSection, VenueMapEmbed, VenueSocialRow } from '@/components/directory/VenuePublicBlocks';
import { ListingTracker } from '@/components/directory/ListingTracker';
import { ListingLeadModal } from '@/components/directory/ListingLeadModal';

const APP_BASE = process.env.NEXT_PUBLIC_DASHBOARD_URL || 'https://app.storyvenue.com';

/**
 * Convert a raw Nominatim display_name into a clean US-style address:
 *   "1090 Ragged Edge Road, Chambersburg, PA 17202"
 *
 * Falls back to just city + state when a street can't be parsed.
 */
function formatVenueAddress(
  locationFull: string | null | undefined,
  locationCity: string | null | undefined,
  locationState: string | null | undefined,
): string | null {
  const city  = locationCity?.trim()  || '';
  const state = locationState?.trim() || '';

  // Extract 5-digit US ZIP from the full address string
  const zip = locationFull?.match(/\b(\d{5})\b/)?.[1] ?? '';

  // Extract street from the Nominatim comma-separated parts.
  // Skip: state names, "United States", ZIP codes, " County", " Township", city.
  let street = '';
  if (locationFull) {
    const SKIP = [
      /^united states$/i,
      /^(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming)$/i,
      /^\d{5}(-\d{4})?$/, // ZIP
      /\b(county|township|parish|borough)\b/i,
    ];
    const parts = locationFull.split(',').map((p) => p.trim()).filter(Boolean);
    const streetParts = parts.filter((p) => {
      if (city && p.toLowerCase() === city.toLowerCase()) return false;
      return !SKIP.some((re) => re.test(p));
    });
    if (streetParts.length >= 2 && /^\d+[a-z]?$/i.test(streetParts[0])) {
      // "1090" + "Ragged Edge Road" → "1090 Ragged Edge Road"
      street = `${streetParts[0]} ${streetParts[1]}`;
    } else if (streetParts.length >= 1) {
      street = streetParts[0];
    }
  }

  // Assemble: "Street, City, State ZIP"
  const line1 = street;
  const line2 = [city, state].filter(Boolean).join(', ') + (zip ? ` ${zip}` : '');
  const parts  = [line1, line2].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

const DIRECTORY_SITE =
  process.env.NEXT_PUBLIC_DIRECTORY_URL || process.env.NEXT_PUBLIC_DIRECTORY_SITE_URL || 'https://storyvenue.com';

/** Build viewer-auth opts from cookies + search params (server-side). */
async function viewerOpts(searchParams: Record<string, string | string[] | undefined>) {
  const cookieStore = await cookies();
  const adminToken  = cookieStore.get('admin_token')?.value ?? null;
  const viewerIsAdmin = Boolean(
    adminToken && process.env.ADMIN_SECRET && adminToken === process.env.ADMIN_SECRET,
  );
  const viewerVenueId = cookieStore.get('venue_id')?.value ?? null;
  const previewToken  = (typeof searchParams.preview === 'string' ? searchParams.preview : null);
  return { viewerIsAdmin, viewerVenueId, previewToken };
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const { slug } = await params;
  const sp   = await searchParams;
  const opts = await viewerOpts(sp);
  const data = await getPublicVenueBySlug(slug, opts);
  if (!data) return { title: 'Venue' };
  const { venue, reviews } = data;
  const loc = [venue.location_city, venue.location_state].filter(Boolean).join(', ');
  const title = loc ? `${venue.name} — ${loc}` : venue.name;
  const desc =
    venue.description?.slice(0, 155) ||
    `Wedding venue${loc ? ` in ${loc}` : ''}.${reviews.count ? ` ${reviews.count} reviews.` : ''}`;

  return {
    title,
    description: desc,
    alternates: { canonical: `${DIRECTORY_SITE.replace(/\/$/, '')}/venue/${venue.slug}` },
    openGraph: { title, description: desc },
  };
}

export default async function PublicVenuePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const sp   = await searchParams;
  const opts = await viewerOpts(sp);
  const data = await getPublicVenueBySlug(slug, opts);
  if (!data) notFound();

  const { venue } = data;
  const locationLine =
    formatVenueAddress(venue.location_full, venue.location_city, venue.location_state) ||
    [venue.location_city, venue.location_state].filter(Boolean).join(', ') ||
    null;

  return (
    <div className="min-h-screen bg-[#fafaf9] pb-12">
      <Ga4Scripts measurementId={venue.ga4_measurement_id} />
      <ListingTracker venueId={venue.id} />
      {!venue.hide_header && (
        <header className="border-b border-gray-200 bg-white/90 px-4 py-4 sm:px-6">
          <div className="mx-auto flex max-w-3xl items-center justify-between">
            <Link href="/" className="text-sm font-semibold text-[#1b1b1b] hover:opacity-80">
              StoryVenue
            </Link>
            <a
              href={`${DIRECTORY_SITE.replace(/\/$/, '')}/venue/${venue.slug}`}
              className="text-xs text-gray-500 hover:text-gray-800"
            >
              Directory
            </a>
          </div>
        </header>
      )}

      {venue.cover_image_url ? (
        <div className="relative h-[min(45vh,420px)] w-full bg-gray-200">
          <Image
            src={venue.cover_image_url}
            alt=""
            fill
            className="object-cover"
            sizes="100vw"
            priority
            unoptimized
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/65 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 px-4 pb-8 sm:px-8">
            <div className="mx-auto max-w-3xl">
              <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
                <h1
                  className="text-3xl font-semibold text-white sm:text-4xl"
                  style={{ fontFamily: "'Open Sans', -apple-system, sans-serif" }}
                >
                  {venue.name}
                </h1>
                <DirectoryListingBadges
                  verified={venue.listing_verified}
                  sponsored={venue.listing_sponsored}
                  variant="onDark"
                />
              </div>
              {locationLine && (
                <p className="mt-2 flex items-center gap-2 text-sm text-white/90">
                  <MapPin size={16} /> {locationLine}
                </p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="border-b border-gray-200 bg-gradient-to-br from-[#f5f2ed] to-[#e8eef5] px-4 py-12 sm:px-8">
          <div className="mx-auto max-w-3xl">
            <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
              <h1
                className="text-3xl font-semibold text-gray-900 sm:text-4xl"
                style={{ fontFamily: "'Open Sans', -apple-system, sans-serif" }}
              >
                {venue.name}
              </h1>
              <DirectoryListingBadges
                verified={venue.listing_verified}
                sponsored={venue.listing_sponsored}
                variant="onLight"
              />
            </div>
            {locationLine && (
              <p className="mt-2 flex items-center gap-2 text-gray-600">
                <MapPin size={18} /> {locationLine}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="mx-auto max-w-3xl space-y-8 px-4 py-10 sm:px-6">
        {/* Lead-capture CTA — only rendered for plans that grant the
            "Pricing Guide" nav permission (marketing tiers). When the box
            is unchecked in super admin we hide the entire block; the rest
            of the page stays exactly the same. */}
        {venue.pricing_guide_enabled && (
          <ListingLeadModal
            venueName={venue.name}
            venueId={venue.id}
            venueSlug={venue.slug}
            apiBase={APP_BASE}
            confirmationBase={DIRECTORY_SITE.replace(/\/$/, '')}
          />
        )}

        {venue.description && (
          <div className="prose prose-gray max-w-none text-[15px] leading-relaxed text-gray-700">
            {venue.description.split(/\n\n+/).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        )}

        {venue.features.length > 0 && (
          <div>
            <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold text-gray-900">
              <Sparkles size={20} className="text-amber-600/90" />
              Features &amp; amenities
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

        <VenueMapEmbed lat={venue.lat} lng={venue.lng} show={venue.show_map} venueName={venue.name} />
        <VenueSocialRow social={venue.social_links} />
        <VenueFaqSection items={venue.faq} />

        <ListingReviewsBlock
          venueName={venue.name}
          reviews={data.reviews}
          googleReviews={data.google_reviews}
        />
      </div>
    </div>
  );
}
