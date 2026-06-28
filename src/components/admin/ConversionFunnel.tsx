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
import { Loader2, RefreshCw, TrendingDown, X } from 'lucide-react';
import type { DateRange } from '@/components/DateRangePicker';

interface Stage {
  key: string;
  label: string;
  count: number;
  pctOfSignups: number;
  stepConversion: number;
  dropFromPrev: number;
}

interface StageVenue {
  id: string;
  name: string | null;
  email: string | null;
  created_at: string | null;
  status: string | null;
  furthestKey: string;
  furthestLabel: string;
}

function fmtDate(ts: string | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const STAGE_COLORS = ['#1b1b1b', '#312e81', '#4338ca', '#6366f1', '#7c3aed', '#9333ea', '#c026d3', '#16a34a'];

export default function ConversionFunnel({ range }: { range?: DateRange }) {
  const [funnel, setFunnel] = useState<Stage[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Drill-down modal — venues that reached the clicked stage.
  const [drill, setDrill] = useState<{ key: string; label: string } | null>(null);
  const [drillVenues, setDrillVenues] = useState<StageVenue[] | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillError, setDrillError] = useState<string | null>(null);

  const openDrill = useCallback(async (stage: Stage) => {
    setDrill({ key: stage.key, label: stage.label });
    setDrillVenues(null);
    setDrillError(null);
    setDrillLoading(true);
    try {
      const params = new URLSearchParams({ stage: stage.key });
      if (range) { params.set('from', range.from); params.set('to', range.to); }
      const r = await fetch(`/api/admin/conversion-funnel/venues?${params}`, { cache: 'no-store' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `Failed (${r.status})`);
      }
      const data = (await r.json()) as { venues: StageVenue[] };
      setDrillVenues(data.venues ?? []);
    } catch (e) {
      setDrillError(e instanceof Error ? e.message : 'Failed to load venues');
    } finally {
      setDrillLoading(false);
    }
  }, [range]);

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
            // Zero conversions => no colored ribbon at all (just the empty track).
            const widthPct = s.count === 0 ? 0 : Math.max(3, (s.count / top) * 100);
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
                  <button
                    type="button"
                    onClick={() => void openDrill(s)}
                    title={`See the ${s.count.toLocaleString()} venue${s.count === 1 ? '' : 's'} in “${s.label}”`}
                    className="group h-7 flex-1 overflow-hidden rounded-md bg-gray-100 text-left transition-shadow hover:ring-2 hover:ring-indigo-300"
                  >
                    <div
                      className="flex h-full items-center rounded-md px-2 text-[11px] font-semibold text-white transition-all"
                      style={{ width: `${widthPct}%`, backgroundColor: STAGE_COLORS[i % STAGE_COLORS.length] }}
                    >
                      {widthPct > 12 ? `${s.count.toLocaleString()}` : ''}
                    </div>
                  </button>
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

      {drill && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setDrill(null)}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-gray-100 px-4 py-3">
              <div>
                <h4 className="text-sm font-semibold text-gray-900">{drill.label}</h4>
                <p className="text-xs text-gray-500">
                  Venues that reached this stage
                  {range ? ` · signed up in ${range.label.toLowerCase()}` : ''}.
                </p>
              </div>
              <button
                onClick={() => setDrill(null)}
                className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-2 py-2">
              {drillLoading && (
                <div className="flex items-center justify-center gap-2 py-8 text-gray-400">
                  <Loader2 size={16} className="animate-spin" /> <span className="text-sm">Loading…</span>
                </div>
              )}
              {drillError && (
                <p className="m-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{drillError}</p>
              )}
              {!drillLoading && !drillError && drillVenues && drillVenues.length === 0 && (
                <p className="px-3 py-8 text-center text-sm text-gray-400">No venues in this stage.</p>
              )}
              {!drillLoading && drillVenues && drillVenues.length > 0 && (
                <ul className="divide-y divide-gray-100">
                  {drillVenues.map((v) => (
                    <li key={v.id} className="flex items-center justify-between gap-3 px-2 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-gray-900">{v.name || 'Untitled venue'}</div>
                        <div className="truncate text-[11px] text-gray-400">{v.email || '—'}</div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end text-right">
                        <span
                          className="inline-flex items-center rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700"
                          title="Furthest stage this venue has reached"
                        >
                          {v.furthestLabel}
                        </span>
                        <span className="mt-0.5 text-[10px] text-gray-400">{fmtDate(v.created_at)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="border-t border-gray-100 px-4 py-2 text-right text-[11px] text-gray-400">
              {drillVenues ? `${drillVenues.length} venue${drillVenues.length === 1 ? '' : 's'}` : ''}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
