import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import type { ReactNode } from 'react';
import {
  BadgeCheck, Facebook, Globe, Instagram, MapPin, Store, ArrowRight,
} from 'lucide-react';
import { Ga4Scripts } from '@/components/Ga4Scripts';
import { LeadLinkTracker } from '@/components/LeadLinkTracker';
import { ListingLeadModal } from '@/components/ListingLeadModal';
import { siteUrl } from '@/lib/site-url';

const API_BASE = siteUrl(process.env.NEXT_PUBLIC_DASHBOARD_URL, 'https://app.storyvenue.com');
const DIRECTORY_SITE = siteUrl(process.env.NEXT_PUBLIC_DIRECTORY_SITE_URL, 'https://storyvenue.com');

type LinksVenuePayload = {
  venue: {
    id: string;
    name: string;
    slug: string;
    location_city: string | null;
    location_state: string | null;
    cover_image_url: string | null;
    social_links: Record<string, string>;
    ga4_measurement_id?: string | null;
    listing_verified?: boolean;
  };
};

const fetchVenue = cache(async (slug: string): Promise<LinksVenuePayload | null> => {
  const url = `${API_BASE}/api/public/venues/${encodeURIComponent(slug)}`;
  const res = await fetch(url, {
    next: { revalidate: 120 },
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return null;
  return res.json() as Promise<LinksVenuePayload>;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await fetchVenue(slug);
  if (!data) return { title: 'Links', robots: { index: false } };
  const { venue } = data;
  const loc = [venue.location_city, venue.location_state].filter(Boolean).join(', ');
  const title = `${venue.name} — Links`;
  const desc = `Connect with ${venue.name}${loc ? ` in ${loc}` : ''}: view the venue listing, download pricing & availability, and follow along on social.`;
  const canonical = `${DIRECTORY_SITE}/venue/${venue.slug}/links`;
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
  };
}

function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
    </svg>
  );
}

function PinterestIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.663.967-2.911 2.168-2.911 1.024 0 1.518.769 1.518 1.688 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 0 1 .083.343l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.631-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24.009 12.017 24.009c6.624 0 11.99-5.367 11.99-11.988C24.007 5.367 18.641.001 12.017.001z" />
    </svg>
  );
}

const SOCIAL_META: Record<string, { label: string; icon: (c: string) => ReactNode }> = {
  instagram: { label: 'Instagram', icon: (c) => <Instagram className={c} /> },
  facebook: { label: 'Facebook', icon: (c) => <Facebook className={c} /> },
  tiktok: { label: 'TikTok', icon: (c) => <TikTokIcon className={c} /> },
  pinterest: { label: 'Pinterest', icon: (c) => <PinterestIcon className={c} /> },
  website: { label: 'Website', icon: (c) => <Globe className={c} /> },
};

export default async function VenueLinksPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await fetchVenue(slug);
  if (!data) notFound();

  const { venue } = data;
  const locationLine = [venue.location_city, venue.location_state].filter(Boolean).join(', ');
  const socials = Object.entries(venue.social_links ?? {}).filter(
    ([key, u]) => key in SOCIAL_META && typeof u === 'string' && /^https?:\/\//i.test(u),
  );

  const listingHref = `/venue/${venue.slug}?utm_source=lead_link&utm_medium=bio&utm_campaign=venue_listing`;

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f5f2ed] via-[#fafaf9] to-[#f0ece5]">
      <Ga4Scripts measurementId={venue.ga4_measurement_id} />
      {venue.id && <LeadLinkTracker venueId={venue.id} />}

      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-5 pb-10 pt-12 sm:pt-16">
        {/* ── Profile header ─────────────────────────────────────────── */}
        <div className="flex flex-col items-center text-center">
          <div className="relative h-28 w-28 overflow-hidden rounded-full border-4 border-white bg-gray-200 shadow-lg">
            {venue.cover_image_url ? (
              <Image
                src={venue.cover_image_url}
                alt={venue.name}
                fill
                priority
                unoptimized
                className="object-cover"
                sizes="112px"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-[#1b1b1b] text-3xl font-semibold text-white">
                {venue.name.charAt(0).toUpperCase()}
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center justify-center gap-1.5">
            <h1
              className="text-2xl font-semibold text-gray-900"
              style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
            >
              {venue.name}
            </h1>
            {venue.listing_verified && (
              <BadgeCheck size={20} className="shrink-0 text-sky-500" aria-label="Verified venue" />
            )}
          </div>
          {locationLine && (
            <p className="mt-1.5 flex items-center gap-1.5 text-sm text-gray-500">
              <MapPin size={14} /> {locationLine}
            </p>
          )}
        </div>

        {/* ── Social icons ───────────────────────────────────────────── */}
        {socials.length > 0 && (
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            {socials.map(([key, url]) => {
              const meta = SOCIAL_META[key];
              return (
                <a
                  key={key}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-track="lead_link_social_click"
                  data-track-platform={key}
                  aria-label={meta.label}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-gray-200 bg-white text-[#1b1b1b] shadow-sm transition-transform hover:-translate-y-0.5 hover:shadow-md"
                >
                  {meta.icon('h-5 w-5')}
                </a>
              );
            })}
          </div>
        )}

        {/* ── Primary links ──────────────────────────────────────────── */}
        <div className="mt-8 space-y-3.5">
          <LinkCard
            href={listingHref}
            icon={<Store size={20} />}
            title="Venue Listing"
            subtitle="Photos, reviews & everything about us"
            platform="listing"
          />
          {/* Pops the lead-capture modal in-page and records the inquiry as a
              real lead under the "Lead Link" funnel source. */}
          <ListingLeadModal
            venueName={venue.name}
            venueId={venue.id}
            venueSlug={venue.slug}
            apiBase={API_BASE}
            source="lead_link"
            variant="card"
          />
        </div>

        {/* ── Footer ─────────────────────────────────────────────────── */}
        <div className="mt-auto pt-12 text-center">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-xs font-medium tracking-wide text-gray-400 transition-colors hover:text-gray-600"
          >
            Powered by StoryVenue
          </Link>
        </div>
      </div>
    </div>
  );
}

function LinkCard({
  href,
  icon,
  title,
  subtitle,
  platform,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  subtitle: string;
  platform: string;
}) {
  return (
    <a
      href={href}
      data-track="lead_link_click"
      data-track-platform={platform}
      className="group flex items-center gap-4 rounded-2xl border border-gray-200 bg-white px-5 py-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#1b1b1b] text-white">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-gray-900">{title}</span>
        <span className="block truncate text-xs text-gray-500">{subtitle}</span>
      </span>
      <ArrowRight
        size={18}
        className="shrink-0 text-gray-300 transition-all group-hover:translate-x-0.5 group-hover:text-gray-500"
      />
    </a>
  );
}
