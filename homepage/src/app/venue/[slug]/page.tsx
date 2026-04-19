import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { MapPin, Users, DollarSign, Home, Sparkles, Star } from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_DASHBOARD_URL || 'https://app.storyvenue.com';
const DIRECTORY_SITE =
  process.env.NEXT_PUBLIC_DIRECTORY_SITE_URL || 'https://storyvenue.com';

type PublicVenuePayload = {
  venue: {
    name: string;
    slug: string;
    description: string | null;
    location_full: string | null;
    location_city: string | null;
    location_state: string | null;
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
};

const fetchVenue = cache(async (slug: string): Promise<PublicVenuePayload | null> => {
  const res = await fetch(`${API_BASE}/api/public/venues/${encodeURIComponent(slug)}`, {
    next: { revalidate: 120 },
    headers: { Accept: 'application/json' },
  });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return res.json() as Promise<PublicVenuePayload>;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await fetchVenue(slug);
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

export default async function PublicVenuePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await fetchVenue(slug);
  if (!data) notFound();

  const { venue, reviews } = data;
  const locationLine =
    venue.location_full ||
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
      ? { address: { '@type': 'PostalAddress', streetAddress: locationLine } }
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
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="min-h-screen bg-[#fafaf9]">
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
                  <h1
                    className="text-4xl font-semibold tracking-tight text-white sm:text-5xl"
                    style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
                  >
                    {venue.name}
                  </h1>
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
                <h1
                  className="text-4xl font-semibold tracking-tight text-gray-900 sm:text-5xl"
                  style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
                >
                  {venue.name}
                </h1>
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
                        className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm"
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
                        className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-gray-200 shadow-sm"
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
              <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
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

          <section id="reviews" className="scroll-mt-28">
            <div className="mb-8 flex flex-col gap-4 border-b border-gray-200 pb-8 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2
                  className="text-2xl text-gray-900 sm:text-3xl"
                  style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
                >
                  Reviews
                </h2>
                <p className="mt-1 text-sm text-gray-500">Couples who celebrated here</p>
              </div>
              {reviews.count > 0 && roundedAvg != null && (
                <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
                  <span className="text-3xl tabular-nums text-gray-900" style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>
                    {roundedAvg}
                  </span>
                  <div>
                    <Stars value={Math.round(roundedAvg)} size={16} />
                    <p className="text-xs text-gray-500">{reviews.count} reviews</p>
                  </div>
                </div>
              )}
            </div>

            {reviews.items.length === 0 ? (
              <p className="rounded-3xl border border-dashed border-gray-300 bg-white/60 px-6 py-14 text-center text-sm text-gray-500">
                No reviews published yet. Check back soon.
              </p>
            ) : (
              <ul className="space-y-5">
                {reviews.items.map((r) => (
                  <li
                    key={r.id}
                    className="rounded-3xl border border-gray-200/90 bg-white p-6 shadow-sm transition hover:shadow-md"
                  >
                    <Stars value={r.rating} />
                    {r.title && (
                      <h3
                        className="mt-3 text-lg text-gray-900"
                        style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
                      >
                        {r.title}
                      </h3>
                    )}
                    <p className="mt-2 text-[15px] leading-relaxed text-gray-700">{r.body}</p>
                    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                      <span className="font-semibold text-gray-800">{r.reviewer_name}</span>
                      {r.wedding_date && (
                        <span>
                          Wedding{' '}
                          {new Date(r.wedding_date + 'T12:00:00').toLocaleDateString(undefined, {
                            month: 'long',
                            year: 'numeric',
                          })}
                        </span>
                      )}
                      <span>
                        {new Date(r.created_at).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
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
