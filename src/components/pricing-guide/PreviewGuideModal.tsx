'use client';

import { useEffect, useRef } from 'react';
import { X, Star, MapPin, Calendar } from 'lucide-react';

/**
 * Continuous vertical-scroll preview of the Pricing & Availability Guide.
 * Renders every section as a full-width magazine page stacked vertically,
 * so the owner scrolls down through the entire guide just like a bride
 * would in the final digital version.
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

export default function PreviewGuideModal({ open, guide, venue, onClose }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reset scroll to top when opening
  useEffect(() => {
    if (open && scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [open]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const venueName = venue.name ?? 'Our Venue';
  const venueLocation = [venue.location_city, venue.location_state].filter(Boolean).join(', ');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 sm:p-6">
      <div className="relative flex h-full max-h-[95vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        {/* Top bar */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-3">
          <div>
            <h3 className="font-heading text-lg text-gray-900">Guide preview</h3>
            <p className="text-xs text-gray-500">Scroll to preview the full guide</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-gray-500 hover:bg-gray-100"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable magazine */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto bg-stone-100">
          <div className="mx-auto w-full" style={{ maxWidth: 480 }}>
            {/* ── Cover ── */}
            <MagCover guide={guide} venueName={venueName} venueLocation={venueLocation} />

            {/* ── Welcome ── */}
            {guide.congratulatory_message?.trim() && (
              <MagSection>
                <WelcomePage guide={guide} venueName={venueName} />
              </MagSection>
            )}

            {/* ── Gallery ── */}
            {guide.gallery.length > 0 && (
              <MagSection>
                <GalleryPage guide={guide} />
              </MagSection>
            )}

            {/* ── About ── */}
            {guide.about_venue?.trim() && (
              <MagSection>
                <AboutPage guide={guide} venueName={venueName} />
              </MagSection>
            )}

            {/* ── Spaces ── */}
            {guide.spaces.length > 0 && (
              <MagSection>
                <SpacesPage guide={guide} />
              </MagSection>
            )}

            {/* ── Accommodations ── */}
            {guide.accommodations_text?.trim() && (
              <MagSection>
                <AccommodationsPage guide={guide} />
              </MagSection>
            )}

            {/* ── Pricing ── */}
            {(guide.pricing_intro?.trim() || guide.packages.length > 0) && (
              <MagSection>
                <PricingPage guide={guide} />
              </MagSection>
            )}

            {/* ── Reviews ── */}
            {guide.reviews.length > 0 && (
              <MagSection>
                <ReviewsPage guide={guide} />
              </MagSection>
            )}

            {/* ── Availability ── */}
            {guide.availability_text?.trim() && (
              <MagSection>
                <AvailabilityPage guide={guide} />
              </MagSection>
            )}

            {/* ── Save the Date / CTA ── */}
            {(guide.cta_headline?.trim() || guide.cta_body?.trim()) && (
              <MagSection>
                <CtaPage guide={guide} venueName={venueName} />
              </MagSection>
            )}
          </div>
        </div>

        {/* Bottom hint */}
        <div className="border-t border-gray-200 px-6 py-2.5 text-center text-xs text-gray-400">
          Scroll to explore the guide. Close with Esc.
        </div>
      </div>
    </div>
  );
}

// ─── Layout primitives ──────────────────────────────────────────────────

/** Wrapper for every section after the cover */
function MagSection({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white shadow-sm">
      {children}
    </div>
  );
}

// ─── Page renderers ─────────────────────────────────────────────────────

function CoverPage({ guide, venueName, venueLocation }: { guide: Guide; venueName: string; venueLocation: string }) {
  const coverSrc = guide.cover_image_url ?? guide.cover_source_image_url ?? guide.gallery[0]?.url ?? null;
  return (
    <div className="relative w-full" style={{ aspectRatio: '3 / 4' }}>
      {coverSrc ? (
        <img src={coverSrc} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-b from-stone-200 to-stone-400" />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/20 to-black/70" />
      <div className="relative flex h-full w-full flex-col items-center justify-end p-10 text-center text-white">
        <p className="font-heading text-4xl leading-tight" style={{ fontFamily: '"Playfair Display", serif' }}>
          {venueName}
        </p>
        {venueLocation && (
          <p className="mt-2 text-sm uppercase tracking-[0.3em] text-white/80">{venueLocation}</p>
        )}
        <div className="mt-8 h-px w-24 bg-white/60" />
        <p className="mt-6 text-base uppercase tracking-[0.2em] text-white/90">Pricing &amp; Availability Guide</p>
      </div>
    </div>
  );
}

function MagCover({ guide, venueName, venueLocation }: { guide: Guide; venueName: string; venueLocation: string }) {
  return (
    <div className="bg-white shadow-sm">
      <CoverPage guide={guide} venueName={venueName} venueLocation={venueLocation} />
    </div>
  );
}

function WelcomePage({ guide, venueName }: { guide: Guide; venueName: string }) {
  return (
    <div className="flex w-full flex-col items-center justify-center px-10 py-16 text-center">
      <p className="text-xs uppercase tracking-[0.3em] text-gray-400">A note from</p>
      <h1 className="mt-3 font-heading text-3xl text-gray-900" style={{ fontFamily: '"Playfair Display", serif' }}>
        {venueName}
      </h1>
      <div className="mt-6 h-px w-16 bg-gray-300" />
      <p className="mt-8 max-w-sm text-base leading-relaxed text-gray-700">
        {guide.congratulatory_message}
      </p>
    </div>
  );
}

function GalleryPage({ guide }: { guide: Guide }) {
  const items = guide.gallery.slice(0, 6);
  return (
    <div className="flex w-full flex-col px-8 py-10">
      <h2 className="font-heading text-2xl text-gray-900" style={{ fontFamily: '"Playfair Display", serif' }}>
        The Property
      </h2>
      <div className="mt-6 grid grid-cols-2 gap-3">
        {items.map((g, i) => (
          <div
            key={g.url}
            className={`overflow-hidden rounded-xl bg-stone-100 ${i === 0 ? 'col-span-2' : ''}`}
            style={i === 0 ? { aspectRatio: '16 / 9' } : { aspectRatio: '4 / 3' }}
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
    <div className="flex w-full flex-col px-10 py-12">
      <p className="text-xs uppercase tracking-[0.3em] text-gray-400">About</p>
      <h2 className="mt-3 font-heading text-3xl text-gray-900" style={{ fontFamily: '"Playfair Display", serif' }}>
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
    <div className="flex w-full flex-col px-8 py-10">
      <h2 className="font-heading text-2xl text-gray-900" style={{ fontFamily: '"Playfair Display", serif' }}>
        Our Spaces
      </h2>
      <div className="mt-6 space-y-5">
        {guide.spaces.map((s) => (
          <div key={s.id} className="flex gap-4">
            {s.image_url && (
              <div className="aspect-[4/3] w-24 flex-shrink-0 overflow-hidden rounded-xl bg-stone-100">
                <img src={s.image_url} alt={s.name ?? ''} className="h-full w-full object-cover" />
              </div>
            )}
            <div className="flex-1">
              <h3 className="font-heading text-base text-gray-900" style={{ fontFamily: '"Playfair Display", serif' }}>
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
    <div className="flex w-full flex-col px-8 py-10">
      <h2 className="font-heading text-2xl text-gray-900" style={{ fontFamily: '"Playfair Display", serif' }}>
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
    <div className="flex w-full flex-col px-8 py-10">
      <h2 className="font-heading text-2xl text-gray-900" style={{ fontFamily: '"Playfair Display", serif' }}>
        Pricing &amp; Packages
      </h2>
      {guide.pricing_intro && (
        <p className="mt-4 text-sm leading-relaxed text-gray-600 whitespace-pre-wrap">{guide.pricing_intro}</p>
      )}
      <div className="mt-6 space-y-4">
        {guide.packages.map((p) => (
          <div key={p.id} className="rounded-2xl border border-gray-200 bg-stone-50 p-5">
            <div className="flex items-baseline justify-between">
              <h3 className="font-heading text-lg text-gray-900" style={{ fontFamily: '"Playfair Display", serif' }}>
                {p.name ?? 'Untitled package'}
              </h3>
              {p.price_label && <span className="ml-3 flex-shrink-0 font-medium text-gray-700">{p.price_label}</span>}
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
    <div className="flex w-full flex-col px-8 py-10">
      <h2 className="font-heading text-2xl text-gray-900" style={{ fontFamily: '"Playfair Display", serif' }}>
        From Our Couples
      </h2>
      <div className="mt-6 space-y-4">
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
    <div className="flex w-full flex-col px-8 py-10">
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-gray-400">
        <Calendar size={12} /> Availability
      </div>
      <h2 className="mt-3 font-heading text-2xl text-gray-900" style={{ fontFamily: '"Playfair Display", serif' }}>
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
    <div className="flex w-full flex-col items-center justify-center px-10 py-16 text-center">
      <p className="text-xs uppercase tracking-[0.3em] text-gray-400">Save the date</p>
      <h2 className="mt-4 max-w-sm font-heading text-3xl leading-tight text-gray-900" style={{ fontFamily: '"Playfair Display", serif' }}>
        {guide.cta_headline ?? 'Ready to walk the property?'}
      </h2>
      <p className="mt-6 max-w-sm text-base leading-relaxed text-gray-700 whitespace-pre-wrap">
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
