'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  X, Sparkles, Loader2, Copy, Check, Download, ExternalLink, ImageOff,
} from 'lucide-react';
import { TEMPLATE_LABELS, type TemplateKey } from '@/lib/ad-generator/spec';

interface Creative {
  id: string;
  batch_id: string | null;
  variant: number;
  template_key: string | null;
  image_url: string | null;
  headline: string | null;
  bullets: unknown;
  primary_text: string | null;
  meta_headline: string | null;
  destination_url: string | null;
  created_at: string;
}

interface Version {
  key: string;
  createdAt: string;
  items: Creative[];
}

/** Group creatives (already ordered newest-first) into generation "versions". */
function groupVersions(creatives: Creative[]): Version[] {
  const map = new Map<string, Version>();
  for (const c of creatives) {
    const key = c.batch_id || c.created_at.slice(0, 19);
    let v = map.get(key);
    if (!v) {
      v = { key, createdAt: c.created_at, items: [] };
      map.set(key, v);
    }
    v.items.push(c);
  }
  return [...map.values()].map((v) => ({
    ...v,
    items: [...v.items].sort((a, b) => a.variant - b.variant),
  }));
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

function Field({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/70 p-2.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{title}</span>
        <CopyButton text={value} label="Copy" />
      </div>
      <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-gray-800">{value}</p>
    </div>
  );
}

async function downloadImage(url: string, filename: string) {
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

function CreativeCard({ c, venueName }: { c: Creative; venueName: string }) {
  const label = templateLabel(c.template_key);
  const safeName = venueName.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="relative bg-gray-100" style={{ aspectRatio: '1080 / 1350' }}>
        {c.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.image_url} alt={label} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center text-gray-300">
            <ImageOff className="h-8 w-8 mb-1" />
            <span className="text-[11px]">Image unavailable — copy still below</span>
          </div>
        )}
        <span className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white">
          {label}
        </span>
      </div>

      <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
        {c.image_url && (
          <>
            <button
              onClick={() => downloadImage(c.image_url!, `${safeName}-ad-${c.variant}.png`)}
              className="inline-flex items-center gap-1 rounded-md bg-gray-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-gray-700"
            >
              <Download className="h-3 w-3" /> Download
            </button>
            <a
              href={c.image_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50"
            >
              <ExternalLink className="h-3 w-3" /> Open
            </a>
          </>
        )}
      </div>

      <div className="flex flex-col gap-2 p-3">
        {c.primary_text && <Field title="Primary text" value={c.primary_text} />}
        {c.meta_headline && <Field title="Headline" value={c.meta_headline} />}
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
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only ever show the most recent generation (batch). Regenerating replaces it.
  const latest = useMemo(() => groupVersions(creatives)[0] ?? null, [creatives]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/ad-generator?venueId=${encodeURIComponent(venueId)}`, { cache: 'no-store' });
      const json = await res.json();
      if (res.ok) setCreatives(json.creatives || []);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => { load(); }, [load]);

  const generate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/ad-generator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venueId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Generation failed');
      await load();
      onGenerated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }, [venueId, load, onGenerated]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
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
              onClick={generate}
              disabled={generating}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-60"
            >
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {generating ? 'Generating…' : creatives.length ? 'Regenerate' : 'Generate 6 ads'}
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
          )}

          {generating && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-xs text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Writing copy and compositing 6 creatives from this venue&apos;s photos & logo — this takes ~30–50s.
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-20 text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
            </div>
          ) : creatives.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 mb-3">
                <Sparkles className="h-5 w-5 text-gray-400" />
              </div>
              <p className="text-sm font-medium text-gray-700">No ads yet</p>
              <p className="mt-1 max-w-sm text-xs text-gray-400">
                Generate 6 scroll-stopping 1080×1350 creatives with paste-ready Meta copy, built from this venue&apos;s
                real photos, logo and pricing guide. Don&apos;t like them? Hit generate again for a fresh batch of 6.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {(latest?.items ?? []).map((c) => (
                <CreativeCard key={c.id} c={c} venueName={venueName} />
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
