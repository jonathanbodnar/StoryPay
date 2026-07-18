'use client';

/**
 * SmsSequenceAnalyticsPanel — super-admin "SMS Reply Analytics" tab.
 *
 * Mirrors the sub-account Speed to Lead layout (phase sections + message
 * cards) but rolls the numbers up across every venue running the same
 * standard sequence. SMS has no open rate, so the signal is replies: per
 * message we show sends, first-replies, reply rate, and median time-to-reply,
 * which lets us tune the shipped master copy over time.
 *
 * Data: GET /api/admin/sms-sequence-analytics?phase=&from=&to=&venue_id=
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2, RefreshCw, MessageSquare, Reply, Percent, Clock, Building2,
  TrendingUp, Info,
} from 'lucide-react';
import DateRangePicker, { type DateRange, PRESETS } from '@/components/DateRangePicker';

const BRAND = '#1b1b1b';

interface StepRow {
  step_order: number;
  position: number;
  label: string;
  body: string;
  sends: number;
  replies: number;
  replyRate: number;
  medianHoursToReply: number | null;
}
interface PhaseMeta { key: string; title: string; }
interface AnalyticsData {
  phase: string;
  automationName: string;
  phases: PhaseMeta[];
  steps: StepRow[];
  totals: { sends: number; replies: number; replyRate: number; venueCount: number; automationCount: number };
  venues: { id: string; name: string }[];
  repliesTableMissing?: boolean;
  window: { since: string | null; until: string | null };
}

function getDefaultRange(): DateRange {
  const p = PRESETS.find((x) => x.label === 'Last 30 days')!;
  return { ...p.getRange(), label: p.label };
}

function fmtHours(h: number | null): string {
  if (h == null) return '—';
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 48) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

function rateColor(rate: number, best: number): string {
  if (best <= 0) return '#9ca3af';
  if (rate >= best * 0.85) return '#10b981';
  if (rate >= best * 0.5) return '#f59e0b';
  return '#ef4444';
}

function MetricCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2 text-gray-400">
        {icon}
        <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-bold text-gray-900">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-gray-400">{sub}</div>}
    </div>
  );
}

export default function SmsSequenceAnalyticsPanel() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange>(getDefaultRange);
  const [phase, setPhase] = useState<string>('phase2');
  const [venueId, setVenueId] = useState<string>('');
  const [venues, setVenues] = useState<{ id: string; name: string }[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to, phase });
      if (venueId) params.set('venue_id', venueId);
      const r = await fetch(`/api/admin/sms-sequence-analytics?${params}`, { cache: 'no-store' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `Failed (${r.status})`);
      }
      const j = (await r.json()) as AnalyticsData;
      setData(j);
      // Keep the venue dropdown populated even after a venue is selected.
      if (!venueId && j.venues.length) setVenues(j.venues);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, [range, phase, venueId]);

  useEffect(() => { void load(); }, [load]);

  const bestRate = data ? Math.max(0, ...data.steps.map((s) => s.replyRate)) : 0;
  const smsSteps = data?.steps ?? [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900">SMS Reply Analytics</h2>
          <p className="text-xs text-gray-500">
            Which Speed to Lead messages brides reply to, across every venue. Tune the master copy from what actually works.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={venueId}
            onChange={(e) => setVenueId(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-300"
          >
            <option value="">All venues</option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
          <DateRangePicker value={range} onChange={setRange} />
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-600 hover:text-gray-900 disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* Phase tabs */}
      <div className="flex flex-wrap gap-2">
        {(data?.phases ?? [{ key: 'phase2', title: 'Guide Delivered → 14-Day Sequence' }]).map((p) => {
          const active = p.key === phase;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => setPhase(p.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                active ? 'text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              }`}
              style={active ? { backgroundColor: BRAND } : undefined}
            >
              {p.title}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {data?.repliesTableMissing && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <Info size={14} className="mt-0.5 shrink-0" />
          <span>Reply tracking table not found yet. Apply migration 171 (<code>marketing_sms_reply_events</code>) — sends are shown but replies will read 0 until then.</span>
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 size={20} className="animate-spin" />
        </div>
      )}

      {data && (
        <>
          {/* Top-line metrics */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricCard icon={<MessageSquare size={14} />} label="SMS sent" value={data.totals.sends.toLocaleString()} sub="non-test sends in range" />
            <MetricCard icon={<Reply size={14} />} label="First replies" value={data.totals.replies.toLocaleString()} sub="one credit per enrollment" />
            <MetricCard icon={<Percent size={14} />} label="Reply rate" value={`${data.totals.replyRate}%`} sub="replies ÷ sends" />
            <MetricCard
              icon={<Building2 size={14} />}
              label={venueId ? 'Sequence' : 'Venues active'}
              value={venueId ? '1' : data.totals.venueCount.toLocaleString()}
              sub={`${data.totals.automationCount.toLocaleString()} sequence${data.totals.automationCount === 1 ? '' : 's'} tracked`}
            />
          </div>

          {/* Per-message cards */}
          {smsSteps.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-500">
              No SMS steps found for this sequence in the selected range.
            </div>
          ) : (
            <div className="space-y-3">
              {smsSteps.map((s) => {
                const color = rateColor(s.replyRate, bestRate);
                const isBest = s.replyRate > 0 && s.replyRate === bestRate;
                return (
                  <div key={s.step_order} className="rounded-xl border border-gray-200 bg-white p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-[11px] font-bold text-gray-600">
                            {s.position}
                          </span>
                          <span className="text-sm font-semibold text-gray-900">{s.label}</span>
                          {isBest && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                              <TrendingUp size={10} /> Top performer
                            </span>
                          )}
                        </div>
                        {s.body && (
                          <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-gray-600">{s.body}</p>
                        )}
                      </div>

                      {/* Metrics rail */}
                      <div className="flex shrink-0 items-center gap-4">
                        <div className="text-center">
                          <div className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Sent</div>
                          <div className="text-lg font-bold text-gray-900">{s.sends.toLocaleString()}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Replies</div>
                          <div className="text-lg font-bold text-gray-900">{s.replies.toLocaleString()}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Reply rate</div>
                          <div className="text-lg font-bold" style={{ color }}>{s.replyRate}%</div>
                        </div>
                        <div className="text-center">
                          <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-gray-400">
                            <Clock size={10} /> Median
                          </div>
                          <div className="text-lg font-bold text-gray-900">{fmtHours(s.medianHoursToReply)}</div>
                        </div>
                      </div>
                    </div>

                    {/* Reply-rate bar */}
                    <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${Math.min(100, s.replyRate)}%`, backgroundColor: color }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <p className="text-[11px] text-gray-400">
            A reply is credited to the last SMS step sent before the bride responded (one credit per enrollment). Attribution is approximate, which is standard for SMS.
          </p>
        </>
      )}
    </div>
  );
}
