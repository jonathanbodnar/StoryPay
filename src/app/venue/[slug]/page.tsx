import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MapPin } from 'lucide-react';
import { getPublicVenueBySlug } from '@/lib/public-venue-directory';
import { ListingReviewsBlock } from '@/components/directory/ListingReviewsBlock';
import { DirectoryListingBadges } from '@/components/directory/DirectoryListingBadges';
import { Ga4Scripts } from '@/components/directory/Ga4Scripts';
import { VenueFaqSection, VenueMapEmbed, VenueSocialRow } from '@/components/directory/VenuePublicBlocks';
import { ListingTracker } from '@/components/directory/ListingTracker';
import { ListingLeadModal } from '@/components/directory/ListingLeadModal';

const APP_BASE = process.env.NEXT_PUBLIC_DASHBOARD_URL || 'https://app.storyvenue.com';

const DIRECTORY_SITE =
  process.env.NEXT_PUBLIC_DIRECTORY_URL || process.env.NEXT_PUBLIC_DIRECTORY_SITE_URL || 'https://storyvenue.com';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await getPublicVenueBySlug(slug);
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

export default async function PublicVenuePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await getPublicVenueBySlug(slug);
  if (!data) notFound();

  const { venue } = data;
  const locationLine =
    venue.location_full ||
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

        <VenueMapEmbed lat={venue.lat} lng={venue.lng} show={venue.show_map} />
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
