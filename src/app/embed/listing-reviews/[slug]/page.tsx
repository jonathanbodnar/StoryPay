import { notFound } from 'next/navigation';
import { getPublicVenueBySlug } from '@/lib/public-venue-directory';
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
      <ListingReviewsBlock venueName={data.venue.name} reviews={data.reviews} compact />
      <p className="mt-4 text-center text-[10px] text-gray-400">
        Powered by{' '}
        <a href={APP_URL} className="underline hover:text-gray-600" target="_blank" rel="noreferrer">
          StoryVenue
        </a>
      </p>
    </div>
  );
}
