import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Thank You — StoryVenue',
  robots: { index: false },
};

const API_BASE = process.env.NEXT_PUBLIC_DASHBOARD_URL || 'https://app.storyvenue.com';

async function fetchVenueBasics(slug: string): Promise<{ name: string; brand_website: string | null } | null> {
  try {
    const res = await fetch(`${API_BASE}/api/public/venues/${encodeURIComponent(slug)}`, {
      next: { revalidate: 300 },
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { venue?: { name?: string; brand_website?: string | null } };
    return {
      name: data.venue?.name ?? '',
      brand_website: data.venue?.brand_website ?? null,
    };
  } catch {
    return null;
  }
}

export default async function ThankyouPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const venue = await fetchVenueBasics(slug);

  const listingHref = `/venue/${slug}`;
  const venueWebsite =
    venue?.brand_website && venue.brand_website.startsWith('http') ? venue.brand_website : null;
  const venueName = venue?.name || 'the venue';

  return (
    <div className="flex min-h-screen flex-col bg-[#fafaf9]">
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

      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="#10b981"
              strokeWidth={2.5}
              width={32}
              height={32}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <h1
            className="text-2xl font-bold text-gray-900 sm:text-3xl"
            style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
          >
            Thanks for downloading our guide!
          </h1>

          <p className="mt-4 text-base leading-relaxed text-gray-600">
            It&apos;s on the way to your inbox, and we&apos;ll text a copy too. We&apos;ll
            personally follow up to answer any questions you have and check your date.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
            {venueWebsite ? (
              <a
                href={venueWebsite}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#1b1b1b] px-6 py-4 text-sm font-semibold text-white transition hover:bg-[#2d2d2d] active:scale-[0.98]"
              >
                Visit {venueName}&apos;s Website
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            ) : (
              <Link
                href={listingHref}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#1b1b1b] px-6 py-4 text-sm font-semibold text-white transition hover:bg-[#2d2d2d] active:scale-[0.98]"
              >
                Back to Listing
              </Link>
            )}

            <Link
              href={listingHref}
              className="inline-flex items-center justify-center rounded-2xl border border-gray-200 bg-white px-6 py-4 text-sm font-semibold text-gray-700 transition hover:border-gray-300 hover:bg-gray-50 active:scale-[0.98]"
            >
              Back to Listing
            </Link>
          </div>
        </div>
      </main>

      <footer className="border-t border-gray-200 bg-white py-8 text-center text-xs text-gray-400">
        <Link href="/" className="font-medium text-gray-600 hover:text-gray-900">
          StoryVenue
        </Link>
        <span className="mx-2">·</span>
        <span>Listings powered by StoryPay</span>
      </footer>
    </div>
  );
}
