'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  X, Sparkles, Loader2, Copy, Check, Download, ImageOff, ImagePlus, RefreshCw,
} from 'lucide-react';
import { TEMPLATE_LABELS, type TemplateKey } from '@/lib/ad-generator/spec';

interface Creative {
  id: string;
  variant: number;
  template_key: string;
  image: string | null;
  slot_images: string[];
  headline: string;
  bullets: string[];
  image_cta: string;
  primary_text: string;
  meta_headline: string;
  destination_url: string | null;
  /** true when on-image text was edited since the preview was last rendered. */
  dirty?: boolean;
  rendering?: boolean;
}

function templateLabel(key: string | null): string {
  if (key && key in TEMPLATE_LABELS) return TEMPLATE_LABELS[key as TemplateKey];
  return 'Ad';
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked */ }
  };
  return (
    <button
      onClick={copy}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition ${
        copied ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
      }`}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? 'Copied' : label}
    </button>
  );
}

/** Editable copy field: textarea + copy button. Edits are held in modal state. */
function EditField({
  title, value, onChange, rows = 4,
}: { title: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/70 p-2.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{title}</span>
        <CopyButton text={value} label="Copy" />
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className="w-full resize-y rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[12px] leading-relaxed text-gray-800 focus:border-gray-400 focus:outline-none"
      />
    </div>
  );
}

async function downloadDataUrl(url: string, filename: string) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objUrl);
  } catch {
    window.open(url, '_blank');
  }
}

function CreativeCard({
  c, venueId, venueName, onPatch,
}: {
  c: Creative;
  venueId: string;
  venueName: string;
  onPatch: (patch: Partial<Creative>) => void;
}) {
  const label = templateLabel(c.template_key);
  const safeName = venueName.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const isAi = c.slot_images.length === 0; // AI images can't be re-rendered with text
  const [busy, setBusy] = useState(false);

  // Re-render the on-image text (template mode only) and return the fresh PNG.
  const rerender = useCallback(async (): Promise<string | null> => {
    if (isAi) return c.image;
    const res = await fetch('/api/admin/ad-generator/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        venueId,
        templateKey: c.template_key,
        headline: c.headline,
        bullets: c.bullets,
        imageCta: c.image_cta,
        slotImages: c.slot_images,
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Render failed');
    return json.image as string;
  }, [isAi, c.image, c.template_key, c.headline, c.bullets, c.image_cta, c.slot_images, venueId]);

  const updatePreview = async () => {
    if (isAi || busy) return;
    setBusy(true);
    try {
      const img = await rerender();
      if (img) onPatch({ image: img, dirty: false });
    } catch { /* ignore, keep old preview */ } finally { setBusy(false); }
  };

  const download = async () => {
    if (busy) return;
    setBusy(true);
    try {
      let img = c.image;
      if (!isAi && c.dirty) {
        img = await rerender();
        if (img) onPatch({ image: img, dirty: false });
      }
      if (img) await downloadDataUrl(img, `${safeName}-ad-${c.variant}.png`);
    } catch { /* ignore */ } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="relative bg-gray-100" style={{ aspectRatio: '1080 / 1350' }}>
        {c.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.image} alt={label} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center text-gray-300">
            <ImageOff className="h-8 w-8 mb-1" />
            <span className="text-[11px]">Image unavailable — copy still below</span>
          </div>
        )}
        <span className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white">
          {label}
        </span>
        {c.dirty && !isAi && (
          <span className="absolute left-2 top-2 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-semibold text-white">
            Edited — update preview
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
        {!isAi && (
          <button
            onClick={updatePreview}
            disabled={busy || !c.dirty}
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Update preview
          </button>
        )}
        <button
          onClick={download}
          disabled={busy || !c.image}
          className="inline-flex items-center gap-1 rounded-md bg-gray-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} Download
        </button>
      </div>

      <div className="flex flex-col gap-2 p-3">
        {!isAi && (
          <>
            <div className="rounded-lg border border-gray-200 bg-gray-50/70 p-2.5">
              <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">On-image headline</span>
              <input
                value={c.headline}
                onChange={(e) => onPatch({ headline: e.target.value, dirty: true })}
                className="mt-1 w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[13px] font-semibold text-gray-900 focus:border-gray-400 focus:outline-none"
              />
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50/70 p-2.5">
              <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">On-image bullets (one per line)</span>
              <textarea
                value={c.bullets.join('\n')}
                onChange={(e) => onPatch({ bullets: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean), dirty: true })}
                rows={Math.max(3, c.bullets.length)}
                className="mt-1 w-full resize-y rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[12px] leading-relaxed text-gray-800 focus:border-gray-400 focus:outline-none"
              />
            </div>
          </>
        )}
        <EditField title="Primary text (paste into Meta)" value={c.primary_text} onChange={(v) => onPatch({ primary_text: v })} rows={7} />
        <EditField title="Headline (paste into Meta)" value={c.meta_headline} onChange={(v) => onPatch({ meta_headline: v })} rows={2} />
      </div>
    </div>
  );
}

export function AdStudioModal({
  venueId, venueName, onClose, onGenerated,
}: {
  venueId: string;
  venueName: string;
  onClose: () => void;
  onGenerated?: () => void;
}) {
  // The modal never loads past generations. Nothing is persisted server-side:
  // creatives live only in this component's state and are purged on close.
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Off = design templates composited from real photos (fast, pixel-precise).
  // On  = gpt-image-2 designs each creative from the real photos (slower, AI art).
  const [aiMode, setAiMode] = useState(false);

  // Media-folder override.
  const [candidates, setCandidates] = useState<string[]>([]);
  const [picker, setPicker] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/admin/ad-generator?venueId=${encodeURIComponent(venueId)}`);
        const json = await res.json();
        if (alive && Array.isArray(json.photos)) setCandidates(json.photos);
      } catch { /* picker just stays empty */ }
    })();
    return () => { alive = false; };
  }, [venueId]);

  const close = useCallback(() => {
    // Fire-and-forget purge of any legacy stored creatives for this venue.
    fetch(`/api/admin/ad-generator?venueId=${encodeURIComponent(venueId)}`, { method: 'DELETE' }).catch(() => {});
    onGenerated?.(); // let the board refresh its (now-cleared) count
    onClose();
  }, [venueId, onClose, onGenerated]);

  const togglePhoto = (url: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url); else next.add(url);
      return next;
    });
  };

  const generate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const photos = Array.from(selected);
      const res = await fetch('/api/admin/ad-generator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venueId, mode: aiMode ? 'ai' : 'template', ...(photos.length ? { photos } : {}) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Generation failed');
      const batch: Creative[] = (json.creatives || [])
        .slice()
        .sort((a: Creative, b: Creative) => a.variant - b.variant);
      setCreatives(batch);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }, [venueId, aiMode, selected]);

  const patchCreative = (id: string, patch: Partial<Creative>) => {
    setCreatives((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={close}>
      <div
        className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-gray-700" />
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Meta Ad Studio</h3>
              <p className="text-xs text-gray-400">{venueName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPicker((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${
                selected.size ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
              title="Hand-pick which photos from the media folder the ads should use."
            >
              <ImagePlus className="h-3.5 w-3.5" />
              {selected.size ? `${selected.size} photo${selected.size > 1 ? 's' : ''}` : 'Choose photos'}
            </button>
            <label
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50"
              title="Let gpt-image-2 design each creative from this venue's real photos (slower, AI-generated art)."
            >
              <input
                type="checkbox"
                checked={aiMode}
                onChange={(e) => setAiMode(e.target.checked)}
                disabled={generating}
                className="h-3.5 w-3.5 accent-gray-900"
              />
              AI images
            </label>
            <button
              onClick={generate}
              disabled={generating}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-60"
            >
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {generating ? 'Generating…' : creatives.length ? 'Regenerate' : 'Generate 6 ads'}
            </button>
            <button onClick={close} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
          </div>
        </div>

        {/* Photo picker */}
        {picker && (
          <div className="border-b border-gray-100 bg-gray-50/60 px-5 py-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] text-gray-500">
                {selected.size
                  ? `Using ${selected.size} hand-picked photo${selected.size > 1 ? 's' : ''}. `
                  : 'Nothing selected — photos are auto-picked by AI vetting. '}
                Click to toggle.
              </p>
              {selected.size > 0 && (
                <button onClick={() => setSelected(new Set())} className="text-[11px] font-semibold text-gray-500 hover:text-gray-800">
                  Clear
                </button>
              )}
            </div>
            {candidates.length === 0 ? (
              <p className="py-4 text-center text-[11px] text-gray-400">No photos found for this venue.</p>
            ) : (
              <div className="grid max-h-52 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
                {candidates.map((url) => {
                  const on = selected.has(url);
                  return (
                    <button
                      key={url}
                      onClick={() => togglePhoto(url)}
                      className={`relative aspect-square overflow-hidden rounded-lg border-2 transition ${on ? 'border-gray-900' : 'border-transparent hover:border-gray-300'}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="" className="h-full w-full object-cover" />
                      {on && (
                        <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-gray-900 text-white">
                          <Check className="h-2.5 w-2.5" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
          )}

          {generating && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-xs text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              {aiMode
                ? "Writing copy and letting gpt-image-2 design 6 creatives from this venue's real photos — this can take 1–3 min."
                : "Writing copy and compositing 6 creatives from this venue's photos & logo — this takes ~15–30s."}
            </div>
          )}

          {creatives.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 mb-3">
                <Sparkles className="h-5 w-5 text-gray-400" />
              </div>
              <p className="text-sm font-medium text-gray-700">No ads yet</p>
              <p className="mt-1 max-w-sm text-xs text-gray-400">
                Generate 6 scroll-stopping 1080×1350 creatives with paste-ready Meta copy, built from this venue&apos;s
                real photos, logo and pricing guide. Edit any text live, update the preview, then download. Nothing is
                saved — closing this window clears everything.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {creatives.map((c) => (
                <CreativeCard
                  key={c.id}
                  c={c}
                  venueId={venueId}
                  venueName={venueName}
                  onPatch={(patch) => patchCreative(c.id, patch)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-gray-100 px-5 py-2.5 text-center text-[11px] text-gray-400">
          Paste the copy straight into Ads Manager · CTA button: “Download” · Images are 1080×1350 (Feed/Stories safe)
        </div>
      </div>
    </div>
  );
}
