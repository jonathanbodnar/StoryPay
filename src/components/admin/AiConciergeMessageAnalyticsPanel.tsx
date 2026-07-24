'use client';

/**
 * AiConciergeMessageAnalyticsPanel — super-admin "Message analytics" tab.
 *
 * Mirrors SmsSequenceAnalyticsPanel, but for the AI Concierge master-message
 * pool instead of the Speed to Lead sequence. Rolled up across every venue,
 * per master-message angle key we show sends, bride replies (last-touch
 * attributed), and reply rate — so we can tune which angles actually earn
 * replies.
 *
 * Data: GET /api/admin/ai-concierge/message-analytics?from=&to=
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2, RefreshCw, MessageSquare, Reply, Percent, Sparkles, TrendingUp,
} from 'lucide-react';
import DateRangePicker, { type DateRange, PRESETS } from '@/components/DateRangePicker';

interface AngleRow {
  angle: string;
  label: string;
  legacy: boolean;
  sends: number;
  replies: number;
  replyRate: number;
  clicks: number | null;
}
interface AnalyticsData {
  rows: AngleRow[];
  totals: { sends: number; replies: number; replyRate: number; leadsReplied: number };
  clicksTrackable: boolean;
  window: { since: string | null; until: string | null };
}

function getDefaultRange(): DateRange {
  const p = PRESETS.find((x) => x.label === 'Last 30 days')!;
  return { ...p.getRange(), label: p.label };
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

export default function AiConciergeMessageAnalyticsPanel() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange>(getDefaultRange);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to });
      const r = await fetch(`/api/admin/ai-concierge/message-analytics?${params}`, { cache: 'no-store' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `Failed (${r.status})`);
      }
      setData((await r.json()) as AnalyticsData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => { void load(); }, [load]);

  const bestRate = data ? Math.max(0, ...data.rows.map((s) => s.replyRate)) : 0;
  const rows = data?.rows ?? [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Master-message analytics</h2>
          <p className="text-xs text-gray-500">
            Which AI Concierge angles brides reply to, across every venue. A reply is credited to the last angle sent before she responded (one credit per lead).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
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
            <MetricCard icon={<MessageSquare size={14} />} label="Messages sent" value={data.totals.sends.toLocaleString()} sub="AI texts sent in range" />
            <MetricCard icon={<Reply size={14} />} label="Replies" value={data.totals.replies.toLocaleString()} sub="one credit per lead" />
            <MetricCard icon={<Percent size={14} />} label="Reply rate" value={`${data.totals.replyRate}%`} sub="replies ÷ sends" />
            <MetricCard icon={<Sparkles size={14} />} label="Leads who replied" value={data.totals.leadsReplied.toLocaleString()} sub="distinct brides" />
          </div>

          {/* Per-angle table */}
          {rows.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-500">
              No AI Concierge activity in the selected range.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-100 bg-gray-50">
                  <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                    <th className="px-4 py-2.5">Master message</th>
                    <th className="px-4 py-2.5 text-right">Sent</th>
                    <th className="px-4 py-2.5 text-right">Replies</th>
                    <th className="px-4 py-2.5">Reply rate</th>
                    <th className="px-4 py-2.5 text-right">Clicks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((s) => {
                    const color = rateColor(s.replyRate, bestRate);
                    const isBest = s.replyRate > 0 && s.replyRate === bestRate;
                    return (
                      <tr key={s.angle} className="hover:bg-gray-50/60">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900">{s.label}</span>
                            {isBest && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                                <TrendingUp size={10} /> Top
                              </span>
                            )}
                            {s.legacy && (
                              <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">legacy</span>
                            )}
                          </div>
                          <div className="mt-0.5 font-mono text-[10px] text-gray-400">{s.angle}</div>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-gray-900 tabular-nums">{s.sends.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right font-semibold text-gray-900 tabular-nums">{s.replies.toLocaleString()}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="w-12 shrink-0 text-sm font-bold tabular-nums" style={{ color }}>{s.replyRate}%</span>
                            <div className="h-1.5 flex-1 min-w-[60px] overflow-hidden rounded-full bg-gray-100">
                              <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, s.replyRate)}%`, backgroundColor: color }} />
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-400 tabular-nums">
                          {s.clicks == null ? '—' : s.clicks.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-[11px] text-gray-400">
            {!data.clicksTrackable && 'Click tracking is not available for AI Concierge SMS, so the Clicks column shows "—". '}
            Reply attribution is last-touch and approximate, which is standard for SMS.
          </p>
        </>
      )}
    </div>
  );
}
