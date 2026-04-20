import Link from 'next/link';
import { DirectoryListingBadges } from '@/components/DirectoryListingBadges';

const DEFAULT_SITE =
  process.env.NEXT_PUBLIC_DIRECTORY_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://storyvenue.com';

/**
 * Use on city/state/search pages with rows from
 * GET {DASHBOARD_URL}/api/public/directory/venues?state=OH&city=Columbus&q=barn
 */
export function DirectoryVenueCard({
  name,
  slug,
  listing_verified,
  listing_sponsored,
  siteUrl = DEFAULT_SITE,
}: {
  name: string;
  slug: string;
  listing_verified: boolean;
  listing_sponsored: boolean;
  /** Public directory site origin (e.g. https://storyvenue.com) */
  siteUrl?: string;
}) {
  const base = siteUrl.replace(/\/$/, '');
  return (
    <Link
      href={`${base}/venue/${encodeURIComponent(slug)}`}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-gray-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-gray-300 hover:bg-gray-50/80"
    >
      <span className="font-medium text-gray-900">{name}</span>
      <DirectoryListingBadges verified={listing_verified} sponsored={listing_sponsored} variant="onLight" />
    </Link>
  );
}
