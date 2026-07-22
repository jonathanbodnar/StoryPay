import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MapPin } from 'lucide-react';
import { stateFromSlug, cityFromSlug, citySlug } from '@/lib/us-states';
import { fetchHubVenues, fetchCitiesForState } from '@/lib/hub-data';

const SITE_URL = (
  process.env.NEXT_PUBLIC_DIRECTORY_SITE_URL || 'https://storyvenue.com'
).replace(/\/$/, '');

export const revalidate = 3600;

/** Resolve the pretty display city name from the venues actually in the DB. */
async function resolveCityName(stateName: string, citySlugParam: string): Promise<string | null> {
  const cities = await fetchCitiesForState(stateName);
  const match = cities.find((c) => c.slug === citySlugParam);
  return match?.name ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ state: string; city: string }>;
}): Promise<Metadata> {
  const { state, city } = await params;
  const stateName = stateFromSlug(state);
  if (!stateName) return { title: 'Wedding Venues', robots: { index: false } };

  const cityName = (await resolveCityName(stateName, city)) ?? cityFromSlug(city);
  const title = `Wedding Venues in ${cityName}, ${stateName} | Pricing & Availability`;
  const description = `Find wedding venues in ${cityName}, ${stateName}. Compare pricing, capacity, photos, and verified reviews, then check availability for your wedding date on StoryVenue.`;
  const canonical = `${SITE_URL}/venues/${state}/${city}`;

  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, type: 'website' },
  };
}

export default async function CityHubPage({
  params,
}: {
  params: Promise<{ state: string; city: string }>;
}) {
  const { state, city } = await params;
  const stateName = stateFromSlug(state);
  if (!stateName) notFound();

  const cityName = (await resolveCityName(stateName, city)) ?? cityFromSlug(city);
  const allInCity = await fetchHubVenues(stateName, cityName);
  // The venues API does a partial city match; keep only exact slug matches.
  const venues = allInCity.filter(
    (v) => v.location_city && citySlug(v.location_city) === city,
  );

  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `Wedding Venues in ${cityName}, ${stateName}`,
    numberOfItems: venues.length,
    itemListElement: venues.slice(0, 100).map((v, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: v.name,
      url: `${SITE_URL}/venue/${v.slug}`,
    })),
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }} />

      <nav className="sticky top-0 z-20 border-b border-gray-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <Link href="/">
            <Image src="/storyvenue-logo-dark.png" alt="StoryVenue" width={120} height={28} />
          </Link>
          <Link
            href="/venues"
            className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700"
          >
            Search all venues
          </Link>
        </div>
      </nav>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <nav className="mb-4 text-xs text-gray-400" aria-label="Breadcrumb">
          <Link href="/venues" className="hover:text-gray-600">Wedding Venues</Link>
          <span className="mx-1.5">/</span>
          <Link href={`/venues/${state}`} className="hover:text-gray-600">{stateName}</Link>
          <span className="mx-1.5">/</span>
          <span className="text-gray-600">{cityName}</span>
        </nav>

        <h1 className="text-3xl font-bold text-gray-900">
          Wedding Venues in {cityName}, {stateName}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-gray-500">
          Compare wedding venues in {cityName}: pricing, guest capacity, photos, and verified
          couple reviews. Request pricing and check availability for your date directly from
          each listing.
        </p>

        <div className="mt-8">
          {venues.length === 0 ? (
            <p className="py-16 text-center text-sm text-gray-500">
              No published venues in {cityName} yet. Browse all{' '}
              <Link href={`/venues/${state}`} className="text-blue-600 underline">
                wedding venues in {stateName}
              </Link>
              .
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {venues.map((v) => (
                <Link
                  key={v.slug}
                  href={`/venue/${v.slug}`}
                  className="group rounded-2xl border border-gray-200 bg-white p-5 transition-colors hover:border-gray-400"
                >
                  <h3 className="font-semibold text-gray-900 group-hover:underline">{v.name}</h3>
                  {(v.location_city || v.location_state) && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-gray-500">
                      <MapPin size={12} />
                      {[v.location_city, v.location_state].filter(Boolean).join(', ')}
                    </p>
                  )}
                  <p className="mt-3 text-xs font-medium text-gray-400 group-hover:text-gray-600">
                    View pricing &amp; availability →
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="mt-16 border-t border-gray-200 pt-8">
          <p className="text-xs leading-relaxed text-gray-400">
            Planning a wedding in {cityName}, {stateName}? StoryVenue helps couples compare
            local wedding venues side by side, from intimate spaces to large event properties.
            Each listing shows starting price, guest capacity, indoor and outdoor settings,
            amenities, and reviews from real couples, so you can request pricing guides and
            book venue tours without the back and forth.{' '}
            <Link href={`/venues/${state}`} className="underline decoration-gray-300 underline-offset-2 hover:text-gray-600">
              See all wedding venues in {stateName}
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
