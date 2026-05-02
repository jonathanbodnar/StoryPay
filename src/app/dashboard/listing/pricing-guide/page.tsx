'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Loader2, Save, CheckCircle2, AlertCircle, ChevronDown, ChevronRight,
  Plus, Trash2, GripVertical, Image as ImageIcon, Sparkles, Star,
  ArrowLeft, Upload,
} from 'lucide-react';

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

// ─── Image upload helper ─────────────────────────────────────────────────

async function uploadOneImage(file: File): Promise<string> {
  const signedRes = await fetch('/api/venue-media/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type || 'application/octet-stream',
      size: file.size,
    }),
  });
  if (!signedRes.ok) {
    const j = await signedRes.json().catch(() => ({}));
    throw new Error((j as { error?: string }).error ?? `Failed to prepare upload for ${file.name}`);
  }
  const { signedUrl, path, publicUrl } = (await signedRes.json()) as {
    signedUrl: string; path: string; publicUrl: string;
  };
  const putRes = await fetch(signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!putRes.ok) throw new Error(`Upload failed for ${file.name}`);
  // Register in media library — best-effort, never blocks the upload.
  try {
    await fetch('/api/venue-media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path, publicUrl,
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
      }),
    });
  } catch { /* swallow */ }
  return publicUrl;
}

// ─── Page component ─────────────────────────────────────────────────────

export default function PricingGuidePage() {
  const [guide, setGuide] = useState<Guide | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string>('');
  const [schemaMissing, setSchemaMissing] = useState(false);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/listing/pricing-guide', { cache: 'no-store' });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error((j as { error?: string }).error ?? 'Failed to load guide');
        }
        const j = (await res.json()) as { guide: Guide; schemaMissing?: boolean };
        if (!cancelled) {
          setGuide(j.guide);
          if (j.schemaMissing) setSchemaMissing(true);
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

  // ── Image uploads (gallery, accommodations, availability, space images) ─
  const galleryInputRef = useRef<HTMLInputElement>(null);
  async function handleGalleryUpload(files: FileList | null) {
    if (!files || !guide) return;
    setSaving(true);
    try {
      const urls: string[] = [];
      for (const file of Array.from(files)) urls.push(await uploadOneImage(file));
      const nextGallery: GalleryItem[] = [
        ...guide.gallery,
        ...urls.map((url) => ({ url })),
      ];
      updateParent('gallery', nextGallery);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setSaving(false);
      if (galleryInputRef.current) galleryInputRef.current.value = '';
    }
  }
  function removeFromGallery(url: string) {
    if (!guide) return;
    updateParent('gallery', guide.gallery.filter((g) => g.url !== url));
  }

  async function uploadFieldImage(field: 'accommodations_image_url' | 'availability_image_url', file: File) {
    setSaving(true);
    try {
      const url = await uploadOneImage(file);
      updateParent(field, url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally { setSaving(false); }
  }

  async function uploadSpaceImage(spaceId: string, file: File) {
    setSaving(true);
    try {
      const url = await uploadOneImage(file);
      await patchSpace(spaceId, { image_url: url });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally { setSaving(false); }
  }

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
    <div className="mx-auto max-w-4xl space-y-6 py-6 sm:py-8">

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

      {/* ── Cover image (auto-generated, page 1) ───────────────────── */}
      <Section
        title="Front cover"
        hint="The first page of the guide and the image that replaces the listing's stat box on your public page. Auto-generated from your venue photos and logo."
        icon={<ImageIcon size={18} />}
      >
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-[200px_1fr]">
          <div className="aspect-[3/4] w-full overflow-hidden rounded-2xl border border-gray-200 bg-gray-50">
            {guide.cover_image_url ? (
              <img src={guide.cover_image_url} alt="Guide cover" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-gray-400">
                Not generated yet
              </div>
            )}
          </div>
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              The cover is generated automatically using a portrait photo of your venue, your logo, and a
              <em> Pricing & Availability Guide</em> title in Playfair Display. We&apos;ll wire up the generator
              in the next phase — for now, save the rest of the guide and enable it when you&apos;re ready.
            </p>
            <div className="text-xs text-gray-400">
              {guide.cover_generated_at
                ? `Last generated ${new Date(guide.cover_generated_at).toLocaleString()}`
                : 'No cover generated yet.'}
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
        <textarea
          rows={5}
          className={TEXTAREA}
          placeholder={`Congratulations on your engagement! We're so excited to share what makes our venue special…`}
          value={guide.congratulatory_message ?? ''}
          onChange={(e) => updateParent('congratulatory_message', e.target.value)}
        />
      </Section>

      {/* ── Photo gallery ──────────────────────────────────────────── */}
      <Section
        title="Photo gallery"
        hint="A curated set of photos that show off the venue. Drag in landscape and portrait shots; we'll lay them out across the gallery page(s)."
        icon={<ImageIcon size={18} />}
      >
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
          <label className="flex aspect-[4/3] cursor-pointer items-center justify-center rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 text-sm text-gray-500 hover:border-gray-300 hover:bg-white">
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => handleGalleryUpload(e.target.files)}
            />
            <span className="flex flex-col items-center gap-1">
              <Upload size={18} />
              <span>Add photos</span>
            </span>
          </label>
        </div>
      </Section>

      {/* ── About the venue ────────────────────────────────────────── */}
      <Section
        title="About the venue"
        hint="The story of your space — history, vibe, what makes it feel different from anywhere else."
        icon={<ImageIcon size={18} />}
      >
        <textarea
          rows={8}
          className={TEXTAREA}
          placeholder="Tucked into the rolling hills of Napa, our barn-and-vineyard estate has hosted couples for over a decade…"
          value={guide.about_venue ?? ''}
          onChange={(e) => updateParent('about_venue', e.target.value)}
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
                <label className="block aspect-[4/3] w-32 flex-shrink-0 cursor-pointer overflow-hidden rounded-xl border border-gray-200 bg-white">
                  {space.image_url ? (
                    <img src={space.image_url} alt={space.name ?? ''} className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-[11px] text-gray-400">
                      Add photo
                    </span>
                  )}
                  <input
                    type="file" accept="image/*" className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadSpaceImage(space.id, f);
                    }}
                  />
                </label>

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
                  <textarea
                    rows={3}
                    className={TEXTAREA}
                    placeholder="A short description of this space and how it's used."
                    value={space.description ?? ''}
                    onChange={(e) => patchSpace(space.id, { description: e.target.value })}
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
          <textarea
            rows={6}
            className={TEXTAREA}
            placeholder="Our guest cottage sleeps 8, and we partner with three hotels within 10 minutes…"
            value={guide.accommodations_text ?? ''}
            onChange={(e) => updateParent('accommodations_text', e.target.value)}
          />
          <div className="flex items-start gap-4">
            <label className="block aspect-[4/3] w-40 flex-shrink-0 cursor-pointer overflow-hidden rounded-2xl border border-gray-200 bg-gray-50">
              {guide.accommodations_image_url ? (
                <img src={guide.accommodations_image_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-xs text-gray-400">Add photo</span>
              )}
              <input
                type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadFieldImage('accommodations_image_url', f); }}
              />
            </label>
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
        <textarea
          rows={3}
          className={`${TEXTAREA} mb-6`}
          placeholder="Our packages are designed to make it easy to plan with confidence…"
          value={guide.pricing_intro ?? ''}
          onChange={(e) => updateParent('pricing_intro', e.target.value)}
        />

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
              <textarea
                rows={3}
                className={`${TEXTAREA} mt-3`}
                placeholder="The team made every detail feel effortless…"
                value={r.body ?? ''}
                onChange={(e) => {
                  const next = guide.reviews.map((x, i) => i === idx ? { ...x, body: e.target.value } : x);
                  updateParent('reviews', next);
                }}
              />
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
          <textarea
            rows={5}
            className={TEXTAREA}
            placeholder="We typically book 12–18 months in advance. Spring weekends fill first; fall has the strongest availability through October."
            value={guide.availability_text ?? ''}
            onChange={(e) => updateParent('availability_text', e.target.value)}
          />
          <div className="flex items-start gap-4">
            <label className="block aspect-[4/3] w-40 flex-shrink-0 cursor-pointer overflow-hidden rounded-2xl border border-gray-200 bg-gray-50">
              {guide.availability_image_url ? (
                <img src={guide.availability_image_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-xs text-gray-400">Add image</span>
              )}
              <input
                type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadFieldImage('availability_image_url', f); }}
              />
            </label>
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
            <input
              className={INPUT}
              placeholder="Ready to walk the property?"
              value={guide.cta_headline ?? ''}
              onChange={(e) => updateParent('cta_headline', e.target.value)}
            />
          </div>
          <div>
            <label className={LABEL}>Body</label>
            <textarea
              rows={4}
              className={TEXTAREA}
              placeholder="We'd love to show you around. Tap the button below to book a private tour with our team."
              value={guide.cta_body ?? ''}
              onChange={(e) => updateParent('cta_body', e.target.value)}
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
      <textarea
        rows={3}
        className={`${TEXTAREA} mt-3`}
        placeholder="A one-paragraph description of this package."
        value={pkg.description ?? ''}
        onChange={(e) => onChange({ description: e.target.value })}
      />

      {/* Included items */}
      <div className="mt-4">
        <label className={LABEL}>What&apos;s included</label>
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
