'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Pin, PinOff, Play, Pause, RotateCcw, ExternalLink, RefreshCw } from 'lucide-react';
import type { ExperimentView, ElementKey, VariantStat } from '@/lib/funnel-experiments';

const BRAND = '#1b1b1b';
const PAGE_KEY = 'bride-booking-system';
const LIVE_URL = `https://storyvenue.com/${PAGE_KEY}`;

const ELEMENT_META: Record<ElementKey, { label: string; multiline: boolean; hint?: string }> = {
  headline: {
    label: 'Headline',
    multiline: true,
    hint: 'Text after a "|" renders in gold — e.g. "Start Booking More Brides|in 5 Minutes."',
  },
  subheadline: { label: 'Subheadline', multiline: true },
  cta: { label: 'CTA Button', multiline: false },
};

const ELEMENTS: ElementKey[] = ['headline', 'subheadline', 'cta'];

export function FunnelAbPanel() {
  const [view, setView] = useState<ExperimentView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const res = await fetch(`/api/admin/funnel-ab?page=${PAGE_KEY}`, { cache: 'no-store' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error || 'Could not load experiments.');
        return;
      }
      setView(j.view as ExperimentView);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(payload: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/admin/funnel-ab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: PAGE_KEY, ...payload }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error || 'Action failed.');
        return false;
      }
      if (j.view) setView(j.view as ExperimentView);
      return true;
    } catch {
      setErr('Network error.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (loading && !view) {
    return (
      <div className="flex justify-center py-24 text-gray-400">
        <Loader2 className="animate-spin" size={28} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-heading text-xl text-gray-900">Funnel A/B Testing</h2>
          <p className="mt-1 text-sm text-gray-500 max-w-2xl">
            Test up to 5 variations each of the hero headline, subheadline, and CTA on the{' '}
            <a href={LIVE_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline hover:text-gray-700">
              bride-booking-system landing page <ExternalLink size={12} />
            </a>
            . Traffic is auto-allocated to the best performers (Thompson Sampling on CTA click-through).
          </p>
        </div>
        <button
          onClick={load}
          disabled={busy}
          className="flex items-center gap-2 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {err && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>
      )}

      {!view ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white py-14 text-center text-sm text-gray-500">
          Run <code className="font-mono">db/funnel_ab_testing.sql</code> in Supabase, then refresh.
        </div>
      ) : (
        <>
          <PageSettings view={view} busy={busy} onSave={post} />
          {ELEMENTS.map((el) => (
            <ElementCard key={el} element={el} variants={view.elements[el]} busy={busy} onPost={post} />
          ))}
          <p className="text-xs text-gray-400 leading-relaxed">
            &ldquo;Win %&rdquo; is the probability a variant is the best. Turn on Auto-pause to switch off
            losers automatically once one passes 95% with enough traffic, or pin a winner to serve it 100%.
          </p>
        </>
      )}
    </div>
  );
}

function PageSettings({
  view,
  busy,
  onSave,
}: {
  view: ExperimentView;
  busy: boolean;
  onSave: (p: Record<string, unknown>) => Promise<boolean>;
}) {
  const [autoPause, setAutoPause] = useState(view.page.auto_pause);
  const [minImpr, setMinImpr] = useState(view.page.min_impressions);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={autoPause}
            onChange={(e) => {
              setAutoPause(e.target.checked);
              onSave({ action: 'settings', auto_pause: e.target.checked, min_impressions: minImpr });
            }}
            className="h-4 w-4"
          />
          Auto-pause losing variants at 95% confidence
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          Min impressions first
          <input
            type="number"
            value={minImpr}
            min={20}
            onChange={(e) => setMinImpr(Number(e.target.value))}
            onBlur={() => onSave({ action: 'settings', auto_pause: autoPause, min_impressions: minImpr })}
            disabled={busy}
            className="w-24 border border-gray-300 rounded-lg px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
          />
        </label>
      </div>
    </div>
  );
}

function ElementCard({
  element,
  variants,
  busy,
  onPost,
}: {
  element: ElementKey;
  variants: VariantStat[];
  busy: boolean;
  onPost: (p: Record<string, unknown>) => Promise<boolean>;
}) {
  const meta = ELEMENT_META[element];
  const [newContent, setNewContent] = useState('');

  const totalImpr = variants.reduce((s, v) => s + v.impressions, 0);
  const totalClicks = variants.reduce((s, v) => s + v.clicks, 0);

  async function add() {
    const content = newContent.trim();
    if (!content) return;
    const ok = await onPost({ action: 'upsert', element, content });
    if (ok) setNewContent('');
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex items-baseline justify-between">
        <h3 className="font-heading text-lg text-gray-900">{meta.label}</h3>
        <span className="text-xs text-gray-400">
          {variants.length}/5 · {totalImpr.toLocaleString()} views · {totalClicks.toLocaleString()} clicks
        </span>
      </div>
      {meta.hint && <p className="mt-1 text-xs text-gray-400">{meta.hint}</p>}

      <div className="mt-4 space-y-3">
        {variants.map((v) => (
          <VariantRow key={v.id} element={element} variant={v} busy={busy} onPost={onPost} />
        ))}
      </div>

      {variants.length < 5 && (
        <div className="mt-3 flex items-start gap-2">
          {meta.multiline ? (
            <textarea
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder={`Add a ${meta.label.toLowerCase()} variation…`}
              rows={2}
              className="flex-1 border border-gray-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
            />
          ) : (
            <input
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder={`Add a ${meta.label.toLowerCase()} variation…`}
              className="flex-1 border border-gray-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
            />
          )}
          <button
            onClick={add}
            disabled={busy || !newContent.trim()}
            className="shrink-0 flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold text-white hover:opacity-90 transition-all disabled:opacity-50"
            style={{ backgroundColor: BRAND }}
          >
            <Plus size={15} /> Add
          </button>
        </div>
      )}
    </div>
  );
}

function VariantRow({
  element,
  variant,
  busy,
  onPost,
}: {
  element: ElementKey;
  variant: VariantStat;
  busy: boolean;
  onPost: (p: Record<string, unknown>) => Promise<boolean>;
}) {
  const meta = ELEMENT_META[element];
  const [content, setContent] = useState(variant.content);
  const dirty = content.trim() !== variant.content;
  const win = variant.probBest ?? 0;
  const isWinner = variant.enabled && win >= 0.95;

  return (
    <div className={`rounded-lg border p-3 ${variant.enabled ? 'border-gray-200 bg-white' : 'border-gray-200 bg-gray-50 opacity-60'}`}>
      {meta.multiline ? (
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={2}
          className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
        />
      ) : (
        <input
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-gray-900/10"
        />
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
        <span>{variant.impressions.toLocaleString()} views</span>
        <span>{variant.clicks.toLocaleString()} clicks</span>
        <span className="font-medium text-gray-700">{(variant.ctr * 100).toFixed(2)}% CTR</span>
        {variant.enabled && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-16 rounded-full bg-gray-200 overflow-hidden align-middle">
              <span className="block h-full bg-emerald-500" style={{ width: `${Math.round(win * 100)}%` }} />
            </span>
            {Math.round(win * 100)}% win
          </span>
        )}
        {isWinner && (
          <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-700">
            Winner
          </span>
        )}
        {variant.pinned && (
          <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-700">
            Pinned · 100%
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {dirty && (
          <button
            onClick={async () => {
              const ok = await onPost({ action: 'upsert', id: variant.id, element, content: content.trim() });
              if (!ok) setContent(variant.content);
            }}
            disabled={busy}
            className="rounded-lg px-3 py-1.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: BRAND }}
          >
            Save
          </button>
        )}
        <button
          onClick={() => onPost({ action: 'flags', id: variant.id, enabled: !variant.enabled })}
          disabled={busy}
          className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          {variant.enabled ? <><Pause size={12} /> Pause</> : <><Play size={12} /> Enable</>}
        </button>
        <button
          onClick={() => onPost({ action: 'flags', id: variant.id, pinned: !variant.pinned })}
          disabled={busy}
          className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          {variant.pinned ? <><PinOff size={12} /> Unpin</> : <><Pin size={12} /> Pin winner</>}
        </button>
        <button
          onClick={() => onPost({ action: 'reset', id: variant.id })}
          disabled={busy}
          className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50"
        >
          <RotateCcw size={12} /> Reset
        </button>
        <button
          onClick={() => {
            if (confirm('Delete this variation?')) onPost({ action: 'delete', id: variant.id });
          }}
          disabled={busy}
          className="ml-auto flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          <Trash2 size={12} /> Delete
        </button>
      </div>
    </div>
  );
}
