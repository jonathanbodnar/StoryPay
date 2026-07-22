import Link from 'next/link';
import { stateFullName, stateSlug, citySlug } from '@/lib/us-states';

const DIRECTORY_SITE =
  process.env.NEXT_PUBLIC_DIRECTORY_SITE_URL || 'https://storyvenue.com';

/**
 * Evergreen SEO footer rendered on every public venue listing.
 *
 * Two modes:
 *  - Normal listings: keyword-rich paragraph + internal links to the city and
 *    state hub pages (internal link graph for rankings).
 *  - Landing-page mode (hide_header): the paragraph and a single StoryVenue
 *    link only — never links to other venues or hub pages, so paid ad traffic
 *    is not led to competitors.
 */
export function VenueSeoFooter({
  venueName,
  city,
  state,
  venueType,
  landingMode,
}: {
  venueName: string;
  city: string | null;
  state: string | null;
  venueType: string | null;
  landingMode: boolean;
}) {
  const fullState = state ? stateFullName(state) : null;
  const locPhrase = city && fullState ? `${city}, ${fullState}` : (fullState ?? city ?? null);
  const typePhrase = (venueType || 'wedding venue').toLowerCase().includes('venue')
    ? (venueType || 'wedding venue').toLowerCase()
    : `${(venueType || '').toLowerCase()} wedding venue`.trim();

  const cityHubHref =
    city && fullState ? `/venues/${stateSlug(fullState)}/${citySlug(city)}` : null;
  const stateHubHref = fullState ? `/venues/${stateSlug(fullState)}` : null;

  return (
    <footer className="mt-16 border-t border-gray-200 bg-white">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <p className="text-xs leading-relaxed text-gray-400">
          {venueName} is a {typePhrase}
          {locPhrase ? ` in ${locPhrase}` : ''} listed on StoryVenue, the wedding venue
          directory that helps couples compare venue pricing, availability, capacity,
          photos, and verified reviews in one place. Couples planning a wedding
          {locPhrase ? ` in ${locPhrase} and the surrounding area` : ''} use venue
          listings like this one to request pricing guides, check open wedding dates,
          and book venue tours online. Every StoryVenue listing includes transparent
          details about ceremony and reception spaces, indoor and outdoor options,
          guest capacity, catering and bar policies, and what is included in each
          wedding package, so couples can shortlist the right venue faster.
        </p>

        <p className="mt-4 text-xs text-gray-400">
          {landingMode ? (
            <>
              Wedding venue listings by{' '}
              <a
                href={DIRECTORY_SITE}
                className="underline decoration-gray-300 underline-offset-2 hover:text-gray-600"
              >
                StoryVenue
              </a>
              .
            </>
          ) : (
            <>
              Explore more{' '}
              {cityHubHref && city ? (
                <>
                  <Link
                    href={cityHubHref}
                    className="underline decoration-gray-300 underline-offset-2 hover:text-gray-600"
                  >
                    wedding venues in {city}
                  </Link>
                  {' '}or{' '}
                </>
              ) : null}
              {stateHubHref && fullState ? (
                <Link
                  href={stateHubHref}
                  className="underline decoration-gray-300 underline-offset-2 hover:text-gray-600"
                >
                  wedding venues in {fullState}
                </Link>
              ) : (
                <Link
                  href="/venues"
                  className="underline decoration-gray-300 underline-offset-2 hover:text-gray-600"
                >
                  wedding venues
                </Link>
              )}
              {' '}on{' '}
              <a
                href={DIRECTORY_SITE}
                className="underline decoration-gray-300 underline-offset-2 hover:text-gray-600"
              >
                StoryVenue
              </a>
              .
            </>
          )}
        </p>
      </div>
    </footer>
  );
}
