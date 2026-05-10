'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Loader2, Save, CheckCircle2, AlertCircle, ChevronDown, ChevronRight,
  Plus, Trash2, GripVertical, Image as ImageIcon, Sparkles, Star,
  ArrowLeft, Upload, Eye, Wand2, Download,
} from 'lucide-react';
import { AIField } from '@/components/pricing-guide/AIField';
import PreviewGuideModal from '@/components/pricing-guide/PreviewGuideModal';
import { VenueMediaPickerModal } from '@/components/venue-media/VenueMediaPickerModal';
import { generatePricingGuidePdf } from '@/lib/pricing-guide-pdf';

// ─── Types ───────────────────────────────────────────────────────────────

type GalleryItem = { url: string; caption?: string };
type ReviewItem = { author?: string; location?: string; body?: string; rating?: number };

type Space = {
  id: string;
  name: string | null;
  description: string | null;
  capacity: string | null;
  image_url: string | null;
  position: number;
};

type Package = {
  id: string;
  name: string | null;
  price_label: string | null;
  description: string | null;
  included_items: string[];
  position: number;
};

interface Guide {
  venue_id: string;
  enabled: boolean;
  cover_image_url: string | null;
  cover_generated_at: string | null;
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

// ─── Styling primitives ──────────────────────────────────────────────────

const INPUT =
  'w-full rounded-2xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:bg-white transition-colors';
const TEXTAREA =
  'w-full rounded-2xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:bg-white transition-colors resize-y';
const LABEL = 'block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide';
const CARD = 'rounded-3xl border border-gray-200 bg-white p-6 sm:p-8';

// ─── Section wrapper (collapsible) ──────────────────────────────────────

function Section({
  title, hint, icon, defaultOpen = true, children,
}: {
  title: string; hint: string; icon: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={CARD}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start justify-between text-left"
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-600">
            {icon}
          </div>
          <div>
            <h2 className="font-heading text-lg text-gray-900">{title}</h2>
            <p className="mt-0.5 text-sm text-gray-500">{hint}</p>
          </div>
        </div>
        <div className="ml-3 flex-shrink-0 text-gray-400">
          {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </div>
      </button>
      {open && <div className="mt-6">{children}</div>}
    </div>
  );
}

// ─── Page component ─────────────────────────────────────────────────────

type VenueMeta = {
  name: string | null;
  venue_type: string | null;
  location_city: string | null;
  location_state: string | null;
  capacity_min: number | null;
  capacity_max: number | null;
  indoor_outdoor: string | null;
  features: string[];
  logo_url: string | null;
};

type SeedShape = {
  seed: Partial<Guide> & { gallery?: GalleryItem[]; reviews?: ReviewItem[] };
  hasListing: boolean;
  venue?: VenueMeta;
};

export default function PricingGuidePage() {
  const [guide, setGuide] = useState<Guide | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string>('');
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState('');

  async function handleDownloadPdf() {
    if (!guide) return;
    setDownloading(true);
    setDownloadProgress('Preparing…');
    try {
      await generatePricingGuidePdf(guide, {
        name: seedData?.venue?.name ?? null,
        location_city: seedData?.venue?.location_city ?? null,
        location_state: seedData?.venue?.location_state ?? null,
        logo_url: seedData?.venue?.logo_url ?? null,
      }, setDownloadProgress);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDF generation failed');
    } finally {
      setDownloading(false);
      setDownloadProgress('');
    }
  }

  // Media library picker — tracks which field the picker is targeting
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const [mediaPickerTarget, setMediaPickerTarget] = useState<
    | { kind: 'cover' }
    | { kind: 'gallery' }
    | { kind: 'field'; field: 'accommodations_image_url' | 'availability_image_url' }
    | { kind: 'space'; spaceId: string }
    | null
  >(null);

  function openMediaPicker(target: NonNullable<typeof mediaPickerTarget>) {
    setMediaPickerTarget(target);
    setMediaPickerOpen(true);
  }

  function handleMediaSelect(url: string) {
    if (!guide || !mediaPickerTarget) return;
    switch (mediaPickerTarget.kind) {
      case 'cover':
        updateParent('cover_image_url', url);
        break;
      case 'gallery':
        if (!guide.gallery.some((g) => g.url === url) && guide.gallery.length < 9) {
          updateParent('gallery', [...guide.gallery, { url }]);
        }
        break;
      case 'field':
        updateParent(mediaPickerTarget.field, url);
        break;
      case 'space':
        void patchSpace(mediaPickerTarget.spaceId, { image_url: url });
        break;
    }
  }

  // Listing-derived suggestions used by the auto-fill banner and AI extras
  const [seedData, setSeedData] = useState<SeedShape | null>(null);
  const [seedDismissed, setSeedDismissed] = useState(false);
  const [autoFilling, setAutoFilling] = useState(false);

  // Initial load — guide + seed in parallel
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [guideRes, seedRes] = await Promise.all([
          fetch('/api/listing/pricing-guide', { cache: 'no-store' }),
          fetch('/api/listing/pricing-guide/seed', { cache: 'no-store' }),
        ]);
        if (!guideRes.ok) {
          const j = await guideRes.json().catch(() => ({}));
          throw new Error((j as { error?: string }).error ?? 'Failed to load guide');
        }
        const guideJson = (await guideRes.json()) as { guide: Guide; schemaMissing?: boolean };
        const seedJson = seedRes.ok ? ((await seedRes.json()) as SeedShape) : null;
        if (!cancelled) {
          setGuide(guideJson.guide);
          if (guideJson.schemaMissing) setSchemaMissing(true);
          if (seedJson) setSeedData(seedJson);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Debounced parent-row save ─────────────────────────────────────────
  const saveTimer = useRef<NodeJS.Timeout | null>(null);
  const patchParent = useCallback(async (patch: Partial<Guide>) => {
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/listing/pricing-guide', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? 'Save failed');
      }
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, []);

  function updateParent<K extends keyof Guide>(key: K, value: Guide[K]) {
    setGuide((g) => (g ? { ...g, [key]: value } : g));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void patchParent({ [key]: value } as Partial<Guide>); }, 600);
  }

  // ── Spaces CRUD ───────────────────────────────────────────────────────
  async function addSpace() {
    const res = await fetch('/api/listing/pricing-guide/spaces', { method: 'POST', body: JSON.stringify({}) });
    if (!res.ok) { setError('Failed to add space'); return; }
    const { space } = (await res.json()) as { space: Space };
    setGuide((g) => g ? { ...g, spaces: [...g.spaces, space] } : g);
  }
  async function patchSpace(id: string, patch: Partial<Space>) {
    setGuide((g) => g ? { ...g, spaces: g.spaces.map((s) => s.id === id ? { ...s, ...patch } : s) } : g);
    await fetch(`/api/listing/pricing-guide/spaces/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  }
  async function deleteSpace(id: string) {
    if (!confirm('Remove this space?')) return;
    setGuide((g) => g ? { ...g, spaces: g.spaces.filter((s) => s.id !== id) } : g);
    await fetch(`/api/listing/pricing-guide/spaces/${id}`, { method: 'DELETE' });
  }

  // ── Packages CRUD ─────────────────────────────────────────────────────
  async function addPackage() {
    const res = await fetch('/api/listing/pricing-guide/packages', { method: 'POST', body: JSON.stringify({}) });
    if (!res.ok) { setError('Failed to add package'); return; }
    const { package: pkg } = (await res.json()) as { package: Package };
    setGuide((g) => g ? { ...g, packages: [...g.packages, pkg] } : g);
  }
  async function patchPackage(id: string, patch: Partial<Package>) {
    setGuide((g) => g ? { ...g, packages: g.packages.map((p) => p.id === id ? { ...p, ...patch } : p) } : g);
    await fetch(`/api/listing/pricing-guide/packages/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  }
  async function deletePackage(id: string) {
    if (!confirm('Remove this package?')) return;
    setGuide((g) => g ? { ...g, packages: g.packages.filter((p) => p.id !== id) } : g);
    await fetch(`/api/listing/pricing-guide/packages/${id}`, { method: 'DELETE' });
  }

  // ── Image uploads — now handled by VenueMediaPickerModal ───────────────
  function removeFromGallery(url: string) {
    if (!guide) return;
    updateParent('gallery', guide.gallery.filter((g) => g.url !== url));
  }

  // ── Auto-fill from listing ─────────────────────────────────────────────
  //
  // Pulls everything `/seed` returned and merges it into the guide, only for
  // fields the owner hasn't already filled in. We never overwrite their work.
  // Spaces and packages are seeded only when the guide currently has none.
  const autoFillFromListing = useCallback(async () => {
    if (!guide || !seedData?.seed) return;
    setAutoFilling(true);
    setError('');
    try {
      const seed = seedData.seed;
      const parentPatch: Partial<Guide> = {};

      const stringFields: (keyof Guide)[] = [
        'congratulatory_message',
        'about_venue',
        'accommodations_text',
        'pricing_intro',
        'availability_text',
        'cta_headline',
        'cta_body',
        'cover_source_image_url',
      ];
      for (const field of stringFields) {
        const seedVal = (seed as Record<string, unknown>)[field as string];
        const currentVal = guide[field];
        if (typeof seedVal === 'string' && seedVal.trim() && !(typeof currentVal === 'string' && currentVal.trim())) {
          (parentPatch as Record<string, unknown>)[field as string] = seedVal;
        }
      }

      // Gallery: only fill if currently empty
      if (Array.isArray(seed.gallery) && seed.gallery.length > 0 && guide.gallery.length === 0) {
        parentPatch.gallery = seed.gallery;
      }

      // Reviews: only fill if currently empty
      if (Array.isArray(seed.reviews) && seed.reviews.length > 0 && guide.reviews.length === 0) {
        parentPatch.reviews = seed.reviews;
      }

      // Apply parent patch optimistically + persist
      if (Object.keys(parentPatch).length > 0) {
        setGuide((g) => (g ? { ...g, ...parentPatch } : g));
        await patchParent(parentPatch);
      }

      // Spaces: create rows only when no spaces exist yet
      type SeedSpace = { name?: string | null; description?: string | null; capacity?: string | null };
      const seedSpaces = ((seed as Record<string, unknown>).spaces as SeedSpace[] | undefined) ?? [];
      if (seedSpaces.length > 0 && guide.spaces.length === 0) {
        for (const s of seedSpaces) {
          const res = await fetch('/api/listing/pricing-guide/spaces', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: s.name ?? null,
              description: s.description ?? null,
              capacity: s.capacity ?? null,
            }),
          });
          if (res.ok) {
            const { space } = (await res.json()) as { space: Space };
            setGuide((g) => (g ? { ...g, spaces: [...g.spaces, space] } : g));
          }
        }
      }

      setSeedDismissed(true);
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Auto-fill failed');
    } finally {
      setAutoFilling(false);
    }
  }, [guide, seedData, patchParent]);

  // Show the banner only when there's something useful to seed AND the guide
  // is mostly empty (so we don't pester owners who've already started filling).
  const guideIsMostlyEmpty =
    guide
      ? !guide.about_venue?.trim() &&
        !guide.congratulatory_message?.trim() &&
        guide.gallery.length === 0 &&
        guide.spaces.length === 0
      : false;
  const seedIsUseful = !!seedData?.hasListing && !!seedData.seed && Object.keys(seedData.seed).length > 0;
  const showSeedBanner = !seedDismissed && guideIsMostlyEmpty && seedIsUseful;

  // Auto-apply seed on first load when the guide is completely empty
  const autoSeedDone = useRef(false);
  useEffect(() => {
    if (autoSeedDone.current) return;
    if (!guide || !seedData?.seed) return;
    if (!guideIsMostlyEmpty || !seedIsUseful) return;
    autoSeedDone.current = true;
    void autoFillFromListing();
  }, [guide, seedData, guideIsMostlyEmpty, seedIsUseful, autoFillFromListing]);

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center text-gray-400">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }
  if (!guide) {
    return (
      <div className="mx-auto max-w-2xl py-16 text-center text-gray-500">
        Couldn&apos;t load your pricing guide. Try refreshing.
      </div>
    );
  }

  return (
    <div className="space-y-6 py-6 sm:py-8">

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/dashboard/listing" className="mb-2 inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700">
            <ArrowLeft size={14} /> Back to listing
          </Link>
          <h1 className="font-heading text-2xl text-gray-900">Pricing & Availability Guide</h1>
          <p className="mt-1 text-sm text-gray-500 max-w-2xl">
            Build the on-demand guide brides will receive after they fill out the lead form on your public
            listing page. Each section below becomes a page in the downloadable PDF.
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-3">
          {saving ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-gray-400">
              <Loader2 size={12} className="animate-spin" /> Saving…
            </span>
          ) : savedAt ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600">
              <CheckCircle2 size={12} /> Saved
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setShowPreview(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
          >
            <Eye size={14} /> Preview guide
          </button>
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={downloading}
            className="inline-flex items-center gap-1.5 rounded-full bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60"
          >
            {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {downloading ? downloadProgress || 'Generating…' : 'Download PDF'}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {schemaMissing && (
        <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
          <div>
            <strong>One-time setup needed.</strong> This page&apos;s database tables haven&apos;t been
            created yet. An admin needs to run the migration once: open
            {' '}
            <code className="rounded bg-amber-100 px-1.5 py-0.5">/api/admin/run-migration-091</code>
            {' '}
            in your browser while logged into the admin panel, then refresh this page. Edits below
            will not save until that&apos;s done.
          </div>
        </div>
      )}

      {/* ── Auto-fill from listing banner ───────────────────────────── */}
      {showSeedBanner && (
        <div className="flex items-start justify-between gap-4 rounded-3xl border border-violet-200 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-5">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-white text-violet-700 shadow-sm">
              <Wand2 size={18} />
            </div>
            <div>
              <h3 className="font-heading text-base text-gray-900">
                Save 20 minutes — fill the guide from your listing
              </h3>
              <p className="mt-1 text-sm text-gray-700">
                We&apos;ll pre-populate your description, photo gallery, spaces, accommodations,
                reviews, and cover photo from your public venue listing. You can edit everything
                afterward, and use <strong>Ask AI</strong> on any section to polish the wording.
              </p>
            </div>
          </div>
          <div className="flex flex-shrink-0 flex-col items-end gap-2">
            <button
              type="button"
              onClick={autoFillFromListing}
              disabled={autoFilling}
              className="inline-flex items-center gap-1.5 rounded-full bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-violet-700 disabled:opacity-60"
            >
              {autoFilling ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {autoFilling ? 'Filling…' : 'Auto-fill now'}
            </button>
            <button
              type="button"
              onClick={() => setSeedDismissed(true)}
              className="text-xs text-gray-500 hover:text-gray-800"
            >
              Start from blank
            </button>
          </div>
        </div>
      )}

      {/* ── Master enable toggle ───────────────────────────────────── */}
      <div className={`${CARD} flex items-center justify-between`}>
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-600">
            <Sparkles size={18} />
          </div>
          <div>
            <h2 className="font-heading text-lg text-gray-900">Enable on public listing</h2>
            <p className="mt-0.5 text-sm text-gray-500">
              When enabled, brides on your public page will see the guide cover and a
              <em> Download Pricing & Availability Guide</em> button.
            </p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={guide.enabled}
          onClick={() => updateParent('enabled', !guide.enabled)}
          className={`relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full transition-colors ${guide.enabled ? 'bg-emerald-500' : 'bg-gray-300'}`}
        >
          <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${guide.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>

      {/* ── Cover image (page 1) ────────────────────────────────────── */}
      <Section
        title="Front cover"
        hint="The first page of the guide and the image that replaces the listing's stat box on your public page."
        icon={<ImageIcon size={18} />}
      >
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-[200px_1fr]">
          <div className="aspect-[3/4] w-full overflow-hidden rounded-2xl border border-gray-200 bg-gray-50">
            {guide.cover_image_url ? (
              <img src={guide.cover_image_url} alt="Guide cover" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-xs text-gray-400">
                <ImageIcon size={28} className="text-gray-300" />
                <span>No cover yet</span>
              </div>
            )}
          </div>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Upload a portrait-style cover image (8.5×11 ratio recommended) that will appear as a preview
              on your public venue listing and as the first page of your pricing guide.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => openMediaPicker({ kind: 'cover' })}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Upload size={15} />
                {guide.cover_image_url ? 'Replace cover' : 'Upload cover'}
              </button>
              {guide.cover_image_url && (
                <button
                  type="button"
                  onClick={() => updateParent('cover_image_url', null)}
                  className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
                >
                  <Trash2 size={14} />
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>
      </Section>

      {/* ── Welcome / congrats ─────────────────────────────────────── */}
      <Section
        title="Welcome page"
        hint="A short congratulatory note that opens the guide. Set the tone for the bride's first impression."
        icon={<Sparkles size={18} />}
      >
        <label className={LABEL}>Congratulatory message</label>
        <AIField
          section="congratulatory_message"
          value={guide.congratulatory_message ?? ''}
          onChange={(v) => updateParent('congratulatory_message', v)}
          render={({ value, onChange }) => (
            <textarea
              rows={5}
              className={`${TEXTAREA} pr-28`}
              placeholder={`Congratulations on your engagement! We're so excited to share what makes our venue special…`}
              value={value}
              onChange={onChange}
            />
          )}
        />
      </Section>

      {/* ── Photo gallery ──────────────────────────────────────────── */}
      <Section
        title="Photo gallery"
        hint="Upload exactly 9 photos for the best layout. The gallery page uses a pinterest-style grid: rows alternate wide/narrow and equal-thirds columns. Mix landscape and portrait shots — each image is automatically cropped to fill its cell."
        icon={<ImageIcon size={18} />}
      >
        {seedData?.seed?.gallery && seedData.seed.gallery.length > 0 && guide.gallery.length === 0 && (
          <div className="mb-4 flex items-start justify-between gap-3 rounded-2xl border border-violet-200 bg-violet-50 p-3">
            <p className="text-sm text-violet-900">
              <strong>{seedData.seed.gallery.length} photos</strong> from your public listing are ready to use.
            </p>
            <button
              type="button"
              onClick={() => updateParent('gallery', seedData.seed.gallery ?? [])}
              className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700"
            >
              <Sparkles size={12} /> Use them
            </button>
          </div>
        )}
        {/* Photo count guidance */}
        <div className={`mb-3 flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${
          guide.gallery.length === 9
            ? 'bg-green-50 text-green-800 border border-green-200'
            : 'bg-blue-50 text-blue-800 border border-blue-200'
        }`}>
          <span className="font-semibold tabular-nums">{guide.gallery.length}/9 photos</span>
          <span className="text-xs opacity-80">
            {guide.gallery.length === 9
              ? '— perfect! Your gallery fills the full-page pinterest grid.'
              : `— add ${9 - guide.gallery.length} more to complete the 4-row grid with no white space.`}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {guide.gallery.map((g) => (
            <div key={g.url} className="group relative aspect-[4/3] overflow-hidden rounded-2xl border border-gray-200 bg-gray-50">
              <img src={g.url} alt={g.caption ?? ''} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => removeFromGallery(g.url)}
                className="absolute right-2 top-2 hidden h-7 w-7 items-center justify-center rounded-full bg-white text-gray-700 shadow group-hover:inline-flex hover:text-red-600"
                title="Remove"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {guide.gallery.length < 9 && (
            <button
              type="button"
              onClick={() => openMediaPicker({ kind: 'gallery' })}
              className="flex aspect-[4/3] cursor-pointer items-center justify-center rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 text-sm text-gray-500 hover:border-gray-300 hover:bg-white"
            >
              <span className="flex flex-col items-center gap-1">
                <Upload size={18} />
                <span>Add photo ({9 - guide.gallery.length} left)</span>
              </span>
            </button>
          )}
        </div>
      </Section>

      {/* ── About the venue ────────────────────────────────────────── */}
      <Section
        title="About the venue"
        hint="The story of your space — history, vibe, what makes it feel different from anywhere else."
        icon={<ImageIcon size={18} />}
      >
        <AIField
          section="about_venue"
          value={guide.about_venue ?? ''}
          onChange={(v) => updateParent('about_venue', v)}
          render={({ value, onChange }) => (
            <textarea
              rows={8}
              className={`${TEXTAREA} pr-28`}
              placeholder="Tucked into the rolling hills of Napa, our barn-and-vineyard estate has hosted couples for over a decade…"
              value={value}
              onChange={onChange}
            />
          )}
        />
      </Section>

      {/* ── Spaces (CRUD) ──────────────────────────────────────────── */}
      <Section
        title="Spaces"
        hint="Highlight the different rooms, lawns, or buildings the venue offers. Each one becomes its own page in the guide."
        icon={<GripVertical size={18} />}
      >
        <div className="space-y-4">
          {guide.spaces.map((space) => (
            <div key={space.id} className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <div className="flex items-start gap-4">
                {/* Image */}
                <button
                  type="button"
                  onClick={() => openMediaPicker({ kind: 'space', spaceId: space.id })}
                  className="block aspect-[4/3] w-32 flex-shrink-0 cursor-pointer overflow-hidden rounded-xl border border-gray-200 bg-white text-left"
                >
                  {space.image_url ? (
                    <img src={space.image_url} alt={space.name ?? ''} className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-[11px] text-gray-400">
                      Add photo
                    </span>
                  )}
                </button>

                <div className="flex-1 space-y-3">
                  <input
                    className={INPUT}
                    placeholder="Space name (e.g. The Barn, The Garden, Bridal Suite)"
                    value={space.name ?? ''}
                    onChange={(e) => patchSpace(space.id, { name: e.target.value })}
                  />
                  <input
                    className={INPUT}
                    placeholder="Capacity (e.g. Up to 200 seated, 250 cocktail)"
                    value={space.capacity ?? ''}
                    onChange={(e) => patchSpace(space.id, { capacity: e.target.value })}
                  />
                  <AIField
                    section="space_description"
                    value={space.description ?? ''}
                    onChange={(v) => patchSpace(space.id, { description: v })}
                    extras={{ space_name: space.name ?? '', capacity: space.capacity ?? '' }}
                    render={({ value, onChange }) => (
                      <textarea
                        rows={3}
                        className={`${TEXTAREA} pr-28`}
                        placeholder="A short description of this space and how it's used."
                        value={value}
                        onChange={onChange}
                      />
                    )}
                  />
                </div>

                <button
                  type="button"
                  onClick={() => deleteSpace(space.id)}
                  className="flex-shrink-0 rounded-xl p-2 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  title="Remove space"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={addSpace}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 py-4 text-sm font-medium text-gray-600 hover:border-gray-300 hover:bg-white"
          >
            <Plus size={16} /> Add space
          </button>
        </div>
      </Section>

      {/* ── Accommodations ─────────────────────────────────────────── */}
      <Section
        title="Accommodations"
        hint="Lodging on or near the property — getting-ready suites, bridal cottages, partner hotels."
        icon={<ImageIcon size={18} />}
      >
        <div className="space-y-4">
          <AIField
            section="accommodations"
            value={guide.accommodations_text ?? ''}
            onChange={(v) => updateParent('accommodations_text', v)}
            render={({ value, onChange }) => (
              <textarea
                rows={6}
                className={`${TEXTAREA} pr-28`}
                placeholder="Our guest cottage sleeps 8, and we partner with three hotels within 10 minutes…"
                value={value}
                onChange={onChange}
              />
            )}
          />
          <div className="flex items-start gap-4">
            <button
              type="button"
              onClick={() => openMediaPicker({ kind: 'field', field: 'accommodations_image_url' })}
              className="block aspect-[4/3] w-40 flex-shrink-0 cursor-pointer overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 text-left"
            >
              {guide.accommodations_image_url ? (
                <img src={guide.accommodations_image_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-xs text-gray-400">Add photo</span>
              )}
            </button>
            {guide.accommodations_image_url && (
              <button
                type="button"
                onClick={() => updateParent('accommodations_image_url', null)}
                className="text-xs text-gray-500 hover:text-red-600"
              >
                Remove image
              </button>
            )}
          </div>
        </div>
      </Section>

      {/* ── Pricing & packages (CRUD) ──────────────────────────────── */}
      <Section
        title="Pricing & packages"
        hint="A short intro followed by the package cards brides will compare. Each package gets its own card in the guide."
        icon={<GripVertical size={18} />}
      >
        <label className={LABEL}>Pricing intro</label>
        <div className="mb-6">
          <AIField
            section="pricing_intro"
            value={guide.pricing_intro ?? ''}
            onChange={(v) => updateParent('pricing_intro', v)}
            render={({ value, onChange }) => (
              <textarea
                rows={3}
                className={`${TEXTAREA} pr-28`}
                placeholder="Our packages are designed to make it easy to plan with confidence…"
                value={value}
                onChange={onChange}
              />
            )}
          />
        </div>

        <div className="space-y-4">
          {guide.packages.map((pkg) => (
            <PackageEditor
              key={pkg.id}
              pkg={pkg}
              onChange={(patch) => patchPackage(pkg.id, patch)}
              onDelete={() => deletePackage(pkg.id)}
            />
          ))}
          <button
            type="button"
            onClick={addPackage}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 py-4 text-sm font-medium text-gray-600 hover:border-gray-300 hover:bg-white"
          >
            <Plus size={16} /> Add package
          </button>
        </div>
      </Section>

      {/* ── Reviews ────────────────────────────────────────────────── */}
      <Section
        title="Reviews"
        hint="A few of your favorite testimonials. We recommend 3–6 short, punchy quotes."
        icon={<Star size={18} />}
      >
        <div className="space-y-4">
          {guide.reviews.map((r, idx) => (
            <div key={idx} className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <input
                  className={INPUT}
                  placeholder="Author (e.g. Sarah & Mike)"
                  value={r.author ?? ''}
                  onChange={(e) => {
                    const next = guide.reviews.map((x, i) => i === idx ? { ...x, author: e.target.value } : x);
                    updateParent('reviews', next);
                  }}
                />
                <input
                  className={INPUT}
                  placeholder="Location or wedding date (e.g. Married Sept 2024)"
                  value={r.location ?? ''}
                  onChange={(e) => {
                    const next = guide.reviews.map((x, i) => i === idx ? { ...x, location: e.target.value } : x);
                    updateParent('reviews', next);
                  }}
                />
              </div>
              <div className="mt-3">
                <AIField
                  section="review_polish"
                  value={r.body ?? ''}
                  onChange={(v) => {
                    const next = guide.reviews.map((x, i) => i === idx ? { ...x, body: v } : x);
                    updateParent('reviews', next);
                  }}
                  render={({ value, onChange }) => (
                    <textarea
                      rows={3}
                      className={`${TEXTAREA} pr-28`}
                      placeholder="The team made every detail feel effortless…"
                      value={value}
                      onChange={onChange}
                    />
                  )}
                />
              </div>
              <div className="mt-3 flex items-center justify-between">
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => {
                        const next = guide.reviews.map((x, i) => i === idx ? { ...x, rating: n } : x);
                        updateParent('reviews', next);
                      }}
                      className={`p-1 ${(r.rating ?? 0) >= n ? 'text-amber-400' : 'text-gray-300 hover:text-amber-300'}`}
                    >
                      <Star size={16} fill={(r.rating ?? 0) >= n ? 'currentColor' : 'none'} />
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => updateParent('reviews', guide.reviews.filter((_, i) => i !== idx))}
                  className="text-xs text-gray-500 hover:text-red-600"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => updateParent('reviews', [...guide.reviews, { rating: 5 }])}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 py-4 text-sm font-medium text-gray-600 hover:border-gray-300 hover:bg-white"
          >
            <Plus size={16} /> Add review
          </button>
        </div>
      </Section>

      {/* ── Availability ───────────────────────────────────────────── */}
      <Section
        title="Availability"
        hint="A note about how far out you book and what dates are typically open. Add a screenshot of your calendar if helpful."
        icon={<ImageIcon size={18} />}
      >
        <div className="space-y-4">
          <AIField
            section="availability_text"
            value={guide.availability_text ?? ''}
            onChange={(v) => updateParent('availability_text', v)}
            render={({ value, onChange }) => (
              <textarea
                rows={5}
                className={`${TEXTAREA} pr-28`}
                placeholder="We typically book 12 to 18 months in advance. Spring weekends fill first; fall has the strongest availability through October."
                value={value}
                onChange={onChange}
              />
            )}
          />
          <div className="flex items-start gap-4">
            <button
              type="button"
              onClick={() => openMediaPicker({ kind: 'field', field: 'availability_image_url' })}
              className="block aspect-[4/3] w-40 flex-shrink-0 cursor-pointer overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 text-left"
            >
              {guide.availability_image_url ? (
                <img src={guide.availability_image_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-xs text-gray-400">Add image</span>
              )}
            </button>
            {guide.availability_image_url && (
              <button
                type="button"
                onClick={() => updateParent('availability_image_url', null)}
                className="text-xs text-gray-500 hover:text-red-600"
              >
                Remove image
              </button>
            )}
          </div>
        </div>
      </Section>

      {/* ── Save the date / CTA ────────────────────────────────────── */}
      <Section
        title="Save the date"
        hint="The closing call-to-action that invites brides to schedule a tour or book a call."
        icon={<Sparkles size={18} />}
      >
        <div className="space-y-4">
          <div>
            <label className={LABEL}>Headline</label>
            <AIField
              section="cta_headline"
              value={guide.cta_headline ?? ''}
              onChange={(v) => updateParent('cta_headline', v)}
              render={({ value, onChange }) => (
                <input
                  className={`${INPUT} pr-28`}
                  placeholder="Ready to walk the property?"
                  value={value}
                  onChange={onChange}
                />
              )}
            />
          </div>
          <div>
            <label className={LABEL}>Body</label>
            <AIField
              section="cta_body"
              value={guide.cta_body ?? ''}
              onChange={(v) => updateParent('cta_body', v)}
              render={({ value, onChange }) => (
                <textarea
                  rows={4}
                  className={`${TEXTAREA} pr-28`}
                  placeholder="We'd love to show you around. Tap the button below to book a private tour with our team."
                  value={value}
                  onChange={onChange}
                />
              )}
            />
          </div>
          <div>
            <label className={LABEL}>Button label</label>
            <input
              className={INPUT}
              placeholder="Schedule a tour"
              value={guide.cta_button_label}
              onChange={(e) => updateParent('cta_button_label', e.target.value)}
            />
          </div>
        </div>
      </Section>

      {/* ── Bottom save indicator ──────────────────────────────────── */}
      <div className="flex items-center justify-end gap-2 pb-4 text-xs text-gray-400">
        {saving ? (
          <><Loader2 size={12} className="animate-spin" /> Saving…</>
        ) : savedAt ? (
          <><CheckCircle2 size={12} className="text-emerald-500" /> All changes saved</>
        ) : (
          <><Save size={12} /> Edits save automatically</>
        )}
      </div>

      {/* ── Live preview modal ─────────────────────────────────────── */}
      <PreviewGuideModal
        open={showPreview}
        guide={guide}
        venue={{
          name: seedData?.venue?.name ?? null,
          location_city: seedData?.venue?.location_city ?? null,
          location_state: seedData?.venue?.location_state ?? null,
          logo_url: seedData?.venue?.logo_url ?? null,
        }}
        onClose={() => setShowPreview(false)}
      />

      {/* ── Media library picker ──────────────────────────────────── */}
      <VenueMediaPickerModal
        open={mediaPickerOpen}
        onOpenChange={setMediaPickerOpen}
        mode="image"
        title="Select a photo"
        onSelect={(url) => handleMediaSelect(url)}
      />
    </div>
  );
}

// ─── Package card editor ─────────────────────────────────────────────────

function PackageEditor({
  pkg, onChange, onDelete,
}: {
  pkg: Package;
  onChange: (patch: Partial<Package>) => void;
  onDelete: () => void;
}) {
  const [draftItem, setDraftItem] = useState('');
  const [generatingItems, setGeneratingItems] = useState(false);

  async function generateIncludedItems() {
    setGeneratingItems(true);
    try {
      const res = await fetch('/api/ai/pricing-guide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section: 'package_included_items',
          mode: 'generate',
          extras: {
            package_name: pkg.name ?? '',
            price_label: pkg.price_label ?? '',
            existing_items: pkg.included_items.join('; '),
          },
        }),
      });
      if (!res.ok) return;
      const { text } = (await res.json()) as { text: string };
      const items = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (items.length > 0) {
        onChange({ included_items: items });
      }
    } finally {
      setGeneratingItems(false);
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <input
          className={INPUT}
          placeholder="Package name (e.g. The Estate Package)"
          value={pkg.name ?? ''}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <input
          className={INPUT}
          placeholder="Price label (e.g. $9,500+)"
          value={pkg.price_label ?? ''}
          onChange={(e) => onChange({ price_label: e.target.value })}
        />
      </div>
      <div className="mt-3">
        <AIField
          section="package_description"
          value={pkg.description ?? ''}
          onChange={(v) => onChange({ description: v })}
          extras={{ package_name: pkg.name ?? '', price_label: pkg.price_label ?? '' }}
          render={({ value, onChange: onChangeText }) => (
            <textarea
              rows={3}
              className={`${TEXTAREA} pr-28`}
              placeholder="A one-paragraph description of this package."
              value={value}
              onChange={onChangeText}
            />
          )}
        />
      </div>

      {/* Included items */}
      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between">
          <label className={LABEL} style={{ marginBottom: 0 }}>What&apos;s included</label>
          <button
            type="button"
            onClick={generateIncludedItems}
            disabled={generatingItems}
            className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-60"
          >
            {generatingItems ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            Suggest with AI
          </button>
        </div>
        <ul className="space-y-2">
          {pkg.included_items.map((item, idx) => (
            <li key={idx} className="flex items-center gap-2">
              <span className="flex-shrink-0 text-gray-400">•</span>
              <input
                className={`${INPUT} flex-1`}
                value={item}
                onChange={(e) => {
                  const next = pkg.included_items.map((x, i) => i === idx ? e.target.value : x);
                  onChange({ included_items: next });
                }}
              />
              <button
                type="button"
                onClick={() => onChange({ included_items: pkg.included_items.filter((_, i) => i !== idx) })}
                className="flex-shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                title="Remove item"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex gap-2">
          <input
            className={`${INPUT} flex-1`}
            placeholder="Add an included item (e.g. 8-hour exclusive use)"
            value={draftItem}
            onChange={(e) => setDraftItem(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draftItem.trim()) {
                e.preventDefault();
                onChange({ included_items: [...pkg.included_items, draftItem.trim()] });
                setDraftItem('');
              }
            }}
          />
          <button
            type="button"
            onClick={() => {
              if (!draftItem.trim()) return;
              onChange({ included_items: [...pkg.included_items, draftItem.trim()] });
              setDraftItem('');
            }}
            className="flex-shrink-0 rounded-2xl bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Add
          </button>
        </div>
      </div>

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onDelete}
          className="text-xs text-gray-500 hover:text-red-600"
        >
          Remove package
        </button>
      </div>
    </div>
  );
}
