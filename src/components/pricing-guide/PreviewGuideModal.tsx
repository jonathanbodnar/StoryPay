'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X, Star, MapPin, Calendar } from 'lucide-react';

/**
 * Lightweight preview of the Pricing & Availability Guide as the bride will
 * see it — rendered directly inside a modal so the owner can flip through
 * pages, request changes, and re-trigger AI improvements without leaving the
 * editor.
 *
 * This is intentionally NOT pixel-perfect with the eventual public PDF — it's
 * a functional preview for editing decisions, with a stylesheet that matches
 * the brand fonts (Playfair for headings, Open Sans body).
 */

type GalleryItem = { url: string; caption?: string };
type ReviewItem = { author?: string; location?: string; body?: string; rating?: number };
type Space = {
  id: string;
  name: string | null;
  description: string | null;
  capacity: string | null;
  image_url: string | null;
};
type Package = {
  id: string;
  name: string | null;
  price_label: string | null;
  description: string | null;
  included_items: string[];
};

interface Guide {
  cover_image_url: string | null;
  cover_source_image_url: string | null;
  congratulatory_message: string | null;
  gallery: GalleryItem[];
  about_venue: string | null;
  accommodations_text: string | null;
  accommodations_image_url: string | null;
  pricing_intro: string | null;
  reviews: ReviewItem[];
  availability_text: string | null;
  availability_image_url: string | null;
  cta_headline: string | null;
  cta_body: string | null;
  cta_button_label: string;
  spaces: Space[];
  packages: Package[];
}

interface VenueMeta {
  name: string | null;
  location_city: string | null;
  location_state: string | null;
}

interface Props {
  open: boolean;
  guide: Guide;
  venue: VenueMeta;
  onClose: () => void;
}

type Page =
  | { kind: 'cover' }
  | { kind: 'welcome' }
  | { kind: 'gallery' }
  | { kind: 'about' }
  | { kind: 'spaces' }
  | { kind: 'accommodations' }
  | { kind: 'pricing' }
  | { kind: 'reviews' }
  | { kind: 'availability' }
  | { kind: 'cta' };

function buildPages(g: Guide): Page[] {
  const pages: Page[] = [{ kind: 'cover' }];
  if (g.congratulatory_message?.trim()) pages.push({ kind: 'welcome' });
  if (g.gallery.length > 0) pages.push({ kind: 'gallery' });
  if (g.about_venue?.trim()) pages.push({ kind: 'about' });
  if (g.spaces.length > 0) pages.push({ kind: 'spaces' });
  if (g.accommodations_text?.trim()) pages.push({ kind: 'accommodations' });
  if (g.pricing_intro?.trim() || g.packages.length > 0) pages.push({ kind: 'pricing' });
  if (g.reviews.length > 0) pages.push({ kind: 'reviews' });
  if (g.availability_text?.trim()) pages.push({ kind: 'availability' });
  if (g.cta_headline?.trim() || g.cta_body?.trim()) pages.push({ kind: 'cta' });
  return pages;
}

export default function PreviewGuideModal({ open, guide, venue, onClose }: Props) {
  const pages = buildPages(guide);
  const [pageIdx, setPageIdx] = useState(0);

  useEffect(() => {
    if (!open) setPageIdx(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setPageIdx((i) => Math.min(i + 1, pages.length - 1));
      if (e.key === 'ArrowLeft') setPageIdx((i) => Math.max(i - 1, 0));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, pages.length, onClose]);

  if (!open) return null;
  const page = pages[pageIdx];
  const venueName = venue.name ?? 'Our Venue';
  const venueLocation = [venue.location_city, venue.location_state].filter(Boolean).join(', ');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="relative flex h-full max-h-[900px] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        {/* Top bar */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-3">
          <div>
            <h3 className="font-heading text-lg text-gray-900">Guide preview</h3>
            <p className="text-xs text-gray-500">
              Page {pageIdx + 1} of {pages.length} · {prettyName(page.kind)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPageIdx((i) => Math.max(i - 1, 0))}
              disabled={pageIdx === 0}
              className="rounded-full p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              onClick={() => setPageIdx((i) => Math.min(i + 1, pages.length - 1))}
              disabled={pageIdx === pages.length - 1}
              className="rounded-full p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
            >
              <ChevronRight size={18} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="ml-2 rounded-full p-2 text-gray-500 hover:bg-gray-100"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Page area */}
        <div className="flex-1 overflow-y-auto bg-stone-50">
          <div className="mx-auto my-6 aspect-[3/4] w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-lg">
            <PageContent page={page} guide={guide} venueName={venueName} venueLocation={venueLocation} />
          </div>
        </div>

        {/* Bottom hint */}
        <div className="border-t border-gray-200 px-6 py-2.5 text-center text-xs text-gray-400">
          Use ← → arrow keys to flip pages. Close with Esc.
        </div>
      </div>
    </div>
  );
}

function prettyName(kind: Page['kind']): string {
  switch (kind) {
    case 'cover': return 'Front cover';
    case 'welcome': return 'Welcome';
    case 'gallery': return 'Photo gallery';
    case 'about': return 'About the venue';
    case 'spaces': return 'Spaces';
    case 'accommodations': return 'Accommodations';
    case 'pricing': return 'Pricing & packages';
    case 'reviews': return 'Reviews';
    case 'availability': return 'Availability';
    case 'cta': return 'Save the date';
  }
}

// ─── Page renderers ────────────────────────────────────────────────────────

function PageContent({
  page, guide, venueName, venueLocation,
}: {
  page: Page; guide: Guide; venueName: string; venueLocation: string;
}) {
  switch (page.kind) {
    case 'cover': return <CoverPage guide={guide} venueName={venueName} venueLocation={venueLocation} />;
    case 'welcome': return <WelcomePage guide={guide} venueName={venueName} />;
    case 'gallery': return <GalleryPage guide={guide} />;
    case 'about': return <AboutPage guide={guide} venueName={venueName} />;
    case 'spaces': return <SpacesPage guide={guide} />;
    case 'accommodations': return <AccommodationsPage guide={guide} />;
    case 'pricing': return <PricingPage guide={guide} />;
    case 'reviews': return <ReviewsPage guide={guide} />;
    case 'availability': return <AvailabilityPage guide={guide} />;
    case 'cta': return <CtaPage guide={guide} venueName={venueName} />;
  }
}

function CoverPage({ guide, venueName, venueLocation }: { guide: Guide; venueName: string; venueLocation: string }) {
  const coverSrc = guide.cover_image_url ?? guide.cover_source_image_url ?? guide.gallery[0]?.url ?? null;
  return (
    <div className="relative h-full w-full">
      {coverSrc ? (
        <img src={coverSrc} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-b from-stone-200 to-stone-400" />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/20 to-black/70" />
      <div className="relative flex h-full w-full flex-col items-center justify-end p-10 text-center text-white">
        <p className="font-heading text-5xl leading-tight" style={{ fontFamily: '"Playfair Display", serif' }}>
          {venueName}
        </p>
        {venueLocation && (
          <p className="mt-2 text-sm uppercase tracking-[0.3em] text-white/80">{venueLocation}</p>
        )}
        <div className="mt-8 h-px w-24 bg-white/60" />
        <p className="mt-6 text-base uppercase tracking-[0.2em] text-white/90">Pricing & Availability Guide</p>
      </div>
    </div>
  );
}

function WelcomePage({ guide, venueName }: { guide: Guide; venueName: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center p-12 text-center">
      <p className="text-xs uppercase tracking-[0.3em] text-gray-400">A note from</p>
      <h1 className="mt-3 font-heading text-4xl text-gray-900" style={{ fontFamily: '"Playfair Display", serif' }}>
        {venueName}
      </h1>
      <div className="mt-6 h-px w-16 bg-gray-300" />
      <p className="mt-8 max-w-md text-base leading-relaxed text-gray-700">
        {guide.congratulatory_message}
      </p>
    </div>
  );
}

function GalleryPage({ guide }: { guide: Guide }) {
  const items = guide.gallery.slice(0, 6);
  return (
    <div className="flex h-full w-full flex-col p-8">
      <h2 className="font-heading text-3xl text-gray-900" style={{ fontFamily: '"Playfair Display", serif' }}>
        The Property
      </h2>
      <div className="mt-6 grid flex-1 grid-cols-3 grid-rows-2 gap-3">
        {items.map((g, i) => (
          <div
            key={g.url}
            className={`overflow-hidden rounded-xl bg-stone-100 ${i === 0 ? 'col-span-2 row-span-2' : ''}`}
          >
            <img src={g.url} alt="" className="h-full w-full object-cover" />
          </div>
        ))}
      </div>
    </div>
  );
}

function AboutPage({ guide, venueName }: { guide: Guide; venueName: string }) {
  return (
    <div className="flex h-full w-full flex-col p-12">
      <p className="text-xs uppercase tracking-[0.3em] text-gray-400">About</p>
      <h2 className="mt-3 font-heading text-4xl text-gray-900" style={{ fontFamily: '"Playfair Display", serif' }}>
        {venueName}
      </h2>
      <div className="mt-5 h-px w-16 bg-gray-300" />
      <p className="mt-8 text-base leading-relaxed text-gray-700 whitespace-pre-wrap">
        {guide.about_venue}
      </p>
    </div>
  );
}

function SpacesPage({ guide }: { guide: Guide }) {
  return (
    <div className="flex h-full w-full flex-col overflow-y-auto p-10">
      <h2 className="font-heading text-3xl text-gray-900" style={{ fontFamily: '"Playfair Display", serif' }}>
        Our Spaces
      </h2>
      <div className="mt-6 space-y-5">
        {guide.spaces.map((s) => (
          <div key={s.id} className="flex gap-5">
            {s.image_url && (
              <div className="aspect-[4/3] w-32 flex-shrink-0 overflow-hidden rounded-xl bg-stone-100">
                <img src={s.image_url} alt={s.name ?? ''} className="h-full w-full object-cover" />
              </div>
            )}
            <div className="flex-1">
              <h3 className="font-heading text-lg text-gray-900" style={{ fontFamily: '"Playfair Display", serif' }}>
                {s.name ?? 'Untitled space'}
              </h3>
              {s.capacity && <p className="mt-0.5 text-xs uppercase tracking-wider text-gray-500">{s.capacity}</p>}
              {s.description && (
                <p className="mt-2 text-sm leading-relaxed text-gray-700 whitespace-pre-wrap">{s.description}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AccommodationsPage({ guide }: { guide: Guide }) {
  return (
    <div className="flex h-full w-full flex-col p-10">
      <h2 className="font-heading text-3xl text-gray-900" style={{ fontFamily: '"Playfair Display", serif' }}>
        Accommodations
      </h2>
      {guide.accommodations_image_url && (
        <div className="mt-5 aspect-[16/9] w-full overflow-hidden rounded-xl bg-stone-100">
          <img src={guide.accommodations_image_url} alt="" className="h-full w-full object-cover" />
        </div>
      )}
      <p className="mt-6 text-base leading-relaxed text-gray-700 whitespace-pre-wrap">
        {guide.accommodations_text}
      </p>
    </div>
  );
}

function PricingPage({ guide }: { guide: Guide }) {
  return (
    <div className="flex h-full w-full flex-col overflow-y-auto p-10">
      <h2 className="font-heading text-3xl text-gray-900" style={{ fontFamily: '"Playfair Display", serif' }}>
        Pricing & Packages
      </h2>
      {guide.pricing_intro && (
        <p className="mt-4 text-sm leading-relaxed text-gray-600 whitespace-pre-wrap">{guide.pricing_intro}</p>
      )}
      <div className="mt-6 space-y-4">
        {guide.packages.map((p) => (
          <div key={p.id} className="rounded-2xl border border-gray-200 bg-white p-5">
            <div className="flex items-baseline justify-between">
              <h3 className="font-heading text-xl text-gray-900" style={{ fontFamily: '"Playfair Display", serif' }}>
                {p.name ?? 'Untitled package'}
              </h3>
              {p.price_label && <span className="font-medium text-gray-700">{p.price_label}</span>}
            </div>
            {p.description && (
              <p className="mt-2 text-sm leading-relaxed text-gray-600 whitespace-pre-wrap">{p.description}</p>
            )}
            {p.included_items.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {p.included_items.map((it, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-900" />
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReviewsPage({ guide }: { guide: Guide }) {
  return (
    <div className="flex h-full w-full flex-col overflow-y-auto p-10">
      <h2 className="font-heading text-3xl text-gray-900" style={{ fontFamily: '"Playfair Display", serif' }}>
        From Our Couples
      </h2>
      <div className="mt-6 grid grid-cols-1 gap-4">
        {guide.reviews.map((r, i) => (
          <div key={i} className="rounded-2xl border border-gray-200 bg-stone-50 p-5">
            {(r.rating ?? 0) > 0 && (
              <div className="flex gap-0.5">
                {Array.from({ length: r.rating ?? 5 }).map((_, n) => (
                  <Star key={n} size={14} className="fill-amber-400 text-amber-400" />
                ))}
              </div>
            )}
            {r.body && (
              <p className="mt-3 text-sm leading-relaxed text-gray-800 italic">&ldquo;{r.body}&rdquo;</p>
            )}
            <p className="mt-3 text-xs uppercase tracking-wider text-gray-500">
              {r.author}{r.author && r.location ? ' · ' : ''}{r.location}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function AvailabilityPage({ guide }: { guide: Guide }) {
  return (
    <div className="flex h-full w-full flex-col p-10">
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-gray-400">
        <Calendar size={12} /> Availability
      </div>
      <h2 className="mt-3 font-heading text-3xl text-gray-900" style={{ fontFamily: '"Playfair Display", serif' }}>
        Find your date
      </h2>
      {guide.availability_image_url && (
        <div className="mt-5 aspect-[16/9] w-full overflow-hidden rounded-xl bg-stone-100">
          <img src={guide.availability_image_url} alt="" className="h-full w-full object-cover" />
        </div>
      )}
      <p className="mt-6 text-base leading-relaxed text-gray-700 whitespace-pre-wrap">
        {guide.availability_text}
      </p>
    </div>
  );
}

function CtaPage({ guide, venueName }: { guide: Guide; venueName: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center p-12 text-center">
      <p className="text-xs uppercase tracking-[0.3em] text-gray-400">Save the date</p>
      <h2 className="mt-4 max-w-md font-heading text-4xl leading-tight text-gray-900" style={{ fontFamily: '"Playfair Display", serif' }}>
        {guide.cta_headline ?? 'Ready to walk the property?'}
      </h2>
      <p className="mt-6 max-w-md text-base leading-relaxed text-gray-700 whitespace-pre-wrap">
        {guide.cta_body}
      </p>
      <button
        type="button"
        className="mt-8 inline-flex items-center gap-2 rounded-full bg-gray-900 px-6 py-3 text-sm font-medium text-white"
      >
        <MapPin size={14} /> {guide.cta_button_label || 'Schedule a tour'}
      </button>
      <p className="mt-6 text-xs text-gray-400">{venueName}</p>
    </div>
  );
}
