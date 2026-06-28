'use client';

/**
 * ConversionFunnel — the card-gated Bride Booking System conversion funnel.
 *
 * Horizontal funnel: signup → onboarding → card → publish → activate → paid.
 * Each row shows the absolute count, % of signups, and step-to-step conversion,
 * and highlights the single biggest drop-off so you can see where venues fall
 * off on the way to the $97/mo plan. Data: GET /api/admin/conversion-funnel.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, TrendingDown } from 'lucide-react';
import type { DateRange } from '@/components/DateRangePicker';

interface Stage {
  key: string;
  label: string;
  count: number;
  pctOfSignups: number;
  stepConversion: number;
  dropFromPrev: number;
}

const STAGE_COLORS = ['#1b1b1b', '#312e81', '#4338ca', '#6366f1', '#7c3aed', '#9333ea', '#c026d3', '#16a34a'];

export default function ConversionFunnel({ range }: { range?: DateRange }) {
  const [funnel, setFunnel] = useState<Stage[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = range ? `?${new URLSearchParams({ from: range.from, to: range.to })}` : '';
      const r = await fetch(`/api/admin/conversion-funnel${qs}`, { cache: 'no-store' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `Failed (${r.status})`);
      }
      const data = (await r.json()) as { funnel: Stage[] };
      setFunnel(data.funnel ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load funnel');
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => { void load(); }, [load]);

  const top = useMemo(() => Math.max(1, funnel?.[0]?.count ?? 1), [funnel]);

  // Index of the biggest step drop-off (skip stage 0).
  const worstIdx = useMemo(() => {
    if (!funnel || funnel.length < 2) return -1;
    let idx = -1;
    let worst = -1;
    for (let i = 1; i < funnel.length; i++) {
      if (funnel[i].dropFromPrev > worst) { worst = funnel[i].dropFromPrev; idx = i; }
    }
    return idx;
  }, [funnel]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Conversion funnel → $97/mo</h3>
          <p className="text-xs text-gray-500">
            Where venues fall off from signup to a paid plan
            {range ? ` · signups in ${range.label.toLowerCase()}` : ''}.
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Refresh
        </button>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}

      {!funnel && loading && (
        <div className="flex items-center justify-center gap-2 py-10 text-gray-400">
          <Loader2 size={16} className="animate-spin" /> <span className="text-sm">Loading…</span>
        </div>
      )}

      {funnel && (
        <div className="space-y-2.5">
          {funnel.map((s, i) => {
            const widthPct = Math.max(3, (s.count / top) * 100);
            const isWorst = i === worstIdx && s.dropFromPrev > 0;
            return (
              <div key={s.key}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-medium text-gray-700">{s.label}</span>
                  <span className="tabular-nums text-gray-500">
                    <span className="font-semibold text-gray-900">{s.count.toLocaleString()}</span>
                    <span className="ml-1.5 text-gray-400">{s.pctOfSignups}% of signups</span>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-7 flex-1 overflow-hidden rounded-md bg-gray-100">
                    <div
                      className="flex h-full items-center rounded-md px-2 text-[11px] font-semibold text-white transition-all"
                      style={{ width: `${widthPct}%`, backgroundColor: STAGE_COLORS[i % STAGE_COLORS.length] }}
                    >
                      {widthPct > 12 ? `${s.count.toLocaleString()}` : ''}
                    </div>
                  </div>
                  {i > 0 && (
                    <span
                      className={`w-28 shrink-0 text-right text-[11px] tabular-nums ${isWorst ? 'font-semibold text-red-600' : 'text-gray-400'}`}
                      title="Conversion from the previous stage"
                    >
                      {isWorst && <TrendingDown size={11} className="mr-0.5 inline" />}
                      {s.stepConversion}% from prev
                    </span>
                  )}
                  {i === 0 && <span className="w-28 shrink-0" />}
                </div>
              </div>
            );
          })}

          {worstIdx > 0 && funnel[worstIdx].dropFromPrev > 0 && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
              Biggest drop-off: <strong>{funnel[worstIdx - 1].label} → {funnel[worstIdx].label}</strong>{' '}
              ({funnel[worstIdx].dropFromPrev.toLocaleString()} venues lost, only {funnel[worstIdx].stepConversion}% continue).
            </p>
          )}
        </div>
      )}
    </div>
  );
}
