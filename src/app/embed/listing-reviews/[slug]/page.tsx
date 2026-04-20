import { notFound } from 'next/navigation';
import { getPublicVenueBySlug } from '@/lib/public-venue-directory';
import { Ga4Scripts } from '@/components/directory/Ga4Scripts';
import { DirectoryListingBadges } from '@/components/directory/DirectoryListingBadges';
import { ListingReviewsBlock } from '@/components/directory/ListingReviewsBlock';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com';

export const metadata = {
  robots: { index: false, follow: false },
  title: 'Reviews',
};

export default async function EmbedListingReviewsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await getPublicVenueBySlug(slug);
  if (!data) notFound();

  return (
    <div className="min-h-0 bg-[#fafaf9] p-4 antialiased">
      <Ga4Scripts measurementId={data.venue.ga4_measurement_id} />
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-base font-semibold text-gray-900">{data.venue.name}</span>
        <DirectoryListingBadges
          verified={data.venue.listing_verified}
          sponsored={data.venue.listing_sponsored}
          variant="onLight"
        />
      </div>
      <ListingReviewsBlock
        venueName={data.venue.name}
        reviews={data.reviews}
        googleReviews={data.google_reviews}
        compact
      />
      <p className="mt-4 text-center text-[10px] text-gray-400">
        Powered by{' '}
        <a href={APP_URL} className="underline hover:text-gray-600" target="_blank" rel="noreferrer">
          StoryVenue
        </a>
      </p>
    </div>
  );
}
