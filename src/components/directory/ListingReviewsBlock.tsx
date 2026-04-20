import type { PublicVenuePayload } from '@/lib/public-venue-directory';
import { VenueReviewsTabs } from './VenueReviewsTabs';

type Props = {
  venueName: string;
  reviews: PublicVenuePayload['reviews'];
  googleReviews?: PublicVenuePayload['google_reviews'];
  /** Minimal chrome for iframe embeds */
  compact?: boolean;
};

export function ListingReviewsBlock({ venueName, reviews, googleReviews = null, compact }: Props) {
  return (
    <VenueReviewsTabs
      venueName={venueName}
      storyVenue={reviews}
      google={googleReviews}
      compact={compact}
    />
  );
}
