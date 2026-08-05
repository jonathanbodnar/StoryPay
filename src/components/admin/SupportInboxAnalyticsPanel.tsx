'use client';

/**
 * SupportInboxAnalyticsPanel — super-admin "Support Analytics" tab.
 *
 * Two sections:
 *   1. Concierge Team Performance — bride-inquiry volume, first-response-time
 *      metrics, time-of-day / day-of-week / hour×day heatmap distributions,
 *      SLA trend, after-hours %, and a per-agent leaderboard.
 *      Data: GET /api/admin/support/inbox-analytics?from=&to=
 *   2. Funnel Health by Plan Type — the venue-facing lead funnel aggregated
 *      across 3 venue cohorts (Private Clients / All-Inclusive no-concierge /
 *      $97 SaaS), with click-through drill-down to the underlying venues.
 *      Data: GET /api/admin/support/cohort-funnels?from=&to=[&cohort=&stage=]
 *
 * One DateRangePicker controls both sections.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2, RefreshCw, Inbox, Reply, Percent, Clock, AlertTriangle, MailQuestion,
  Download, TrendingDown, X, Moon, Sparkles,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  AreaChart, Area, Legend,
} from 'recharts';
import DateRangePicker, { type DateRange, PRESETS } from '@/components/DateRangePicker';

// ─── Types ───────────────────────────────────────────────────────────────────

interface InboxSummary {
  totalInquiries: number;
  totalReplies: number;
  replyRate: number;
  avgResponseMinutes: number | null;
  medianResponseMinutes: number | null;
  overdueThreadsCount: number;
  unansweredCount: number;
}
interface DayOfWeekRow { day: string; inbound: number; outbound: number; }
interface LeaderboardRow {
  agentId: string;
  name: string;
  replies: number;
  avgResponseMinutes: number | null;
  medianResponseMinutes: number | null;
  replyRate: number;
  inquiriesHandled: number;
  avgResponseHour: number | null;
  overdueThreads: number;
}
interface SlaTrendRow {
  day: string;
  openTotal: number;
  greenPct: number;
  yellowPct: number;
  redPct: number;
  criticalPct: number;
}
interface InboxAnalyticsData {
  window: { from: string; to: string };
  summary: InboxSummary;
  timeOfDay: { hours: number[]; avgHour: number | null };
  dayOfWeek: DayOfWeekRow[];
  heatmap: number[][];
  afterHours: { pct: number; count: number; total: number; windowLabel: string };
  leaderboard: LeaderboardRow[];
  slaTrend: SlaTrendRow[];
}

interface FunnelStep { key: string; label: string; count: number; }
interface DropOff { fromLabel: string; toLabel: string; dropCount: number; stepConversion: number | null; }
interface CohortFunnel {
  key: string;
  label: string;
  venueCount: number;
  steps: FunnelStep[];
  conversions: (number | null)[];
  leadToWonPct: number | null;
  biggestDropOff: DropOff | null;
  totalBookedValue: number;
}
interface CohortFunnelsData {
  cohorts: CohortFunnel[];
  window: { from: string | null; to: string | null };
}
interface DrillVenue { id: string; name: string; leadCount: number; countAtOrPastStage: number; }

// ─── Helpers ────────────────────────────────────────────────────────────────

function getDefaultRange(): DateRange {
  const p = PRESETS.find((x) => x.label === 'Last 30 days')!;
  return { ...p.getRange(), label: p.label };
}

function fmtMinutes(min: number | null): string {
  if (min == null || !Number.isFinite(min)) return '—';
  if (min < 1) return '<1m';
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function fmtHour(hourFloat: number | null): string {
  if (hourFloat == null || !Number.isFinite(hourFloat)) return '—';
  const h = Math.floor(((hourFloat % 24) + 24) % 24);
  const m = Math.round((hourFloat - Math.floor(hourFloat)) * 60);
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function fmtHourShort(h: number): string {
  const period = h < 12 ? 'a' : 'p';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${period}`;
}

function fmtMoney(n: number): string {
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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

const SLA_COLORS = { green: '#10b981', yellow: '#f59e0b', red: '#f97316', critical: '#dc2626' };
const STAGE_COLORS = ['#1b1b1b', '#4338ca', '#7c3aed', '#16a34a'];

// ─── Main panel ─────────────────────────────────────────────────────────────

export default function SupportInboxAnalyticsPanel() {
  const [range, setRange] = useState<DateRange>(getDefaultRange);

  const [inbox, setInbox] = useState<InboxAnalyticsData | null>(null);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [inboxError, setInboxError] = useState<string | null>(null);

  const [funnels, setFunnels] = useState<CohortFunnelsData | null>(null);
  const [funnelsLoading, setFunnelsLoading] = useState(false);
  const [funnelsError, setFunnelsError] = useState<string | null>(null);

  const [drill, setDrill] = useState<{ cohort: string; cohortLabel: string; stage: string; stageLabel: string } | null>(null);
  const [drillVenues, setDrillVenues] = useState<DrillVenue[] | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillError, setDrillError] = useState<string | null>(null);

  const loadInbox = useCallback(async () => {
    setInboxLoading(true);
    setInboxError(null);
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to });
      const r = await fetch(`/api/admin/support/inbox-analytics?${params}`, { cache: 'no-store' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `Failed (${r.status})`);
      }
      setInbox((await r.json()) as InboxAnalyticsData);
    } catch (e) {
      setInboxError(e instanceof Error ? e.message : 'Failed to load inbox analytics');
    } finally {
      setInboxLoading(false);
    }
  }, [range]);

  const loadFunnels = useCallback(async () => {
    setFunnelsLoading(true);
    setFunnelsError(null);
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to });
      const r = await fetch(`/api/admin/support/cohort-funnels?${params}`, { cache: 'no-store' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `Failed (${r.status})`);
      }
      setFunnels((await r.json()) as CohortFunnelsData);
    } catch (e) {
      setFunnelsError(e instanceof Error ? e.message : 'Failed to load funnel data');
    } finally {
      setFunnelsLoading(false);
    }
  }, [range]);

  useEffect(() => { void loadInbox(); }, [loadInbox]);
  useEffect(() => { void loadFunnels(); }, [loadFunnels]);

  const openDrill = useCallback(async (cohort: CohortFunnel, step: FunnelStep) => {
    setDrill({ cohort: cohort.key, cohortLabel: cohort.label, stage: step.key, stageLabel: step.label });
    setDrillVenues(null);
    setDrillError(null);
    setDrillLoading(true);
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to, cohort: cohort.key, stage: step.key });
      const r = await fetch(`/api/admin/support/cohort-funnels?${params}`, { cache: 'no-store' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `Failed (${r.status})`);
      }
      const data = (await r.json()) as { venues: DrillVenue[] };
      setDrillVenues(data.venues ?? []);
    } catch (e) {
      setDrillError(e instanceof Error ? e.message : 'Failed to load venues');
    } finally {
      setDrillLoading(false);
    }
  }, [range]);

  const heatmapMax = useMemo(() => {
    if (!inbox) return 1;
    let max = 0;
    for (const row of inbox.heatmap) for (const v of row) if (v > max) max = v;
    return Math.max(1, max);
  }, [inbox]);

  const sortedLeaderboard = useMemo(() => {
    if (!inbox) return [];
    return [...inbox.leaderboard].sort((a, b) => b.replies - a.replies);
  }, [inbox]);

  const exportCsv = useCallback(() => {
    const rows: (string | number)[][] = [];
    rows.push(['StoryPay Support Analytics Export']);
    rows.push(['Range', `${range.from} to ${range.to}`]);
    rows.push([]);
    rows.push(['— Per-agent leaderboard —']);
    rows.push(['Agent', 'Replies', 'Avg response (min)', 'Median response (min)', 'Reply rate %', 'Inquiries handled', 'Avg response hour (ET)', 'Overdue threads']);
    for (const a of sortedLeaderboard) {
      rows.push([
        a.name, a.replies,
        a.avgResponseMinutes != null ? Math.round(a.avgResponseMinutes) : '',
        a.medianResponseMinutes != null ? Math.round(a.medianResponseMinutes) : '',
        a.replyRate, a.inquiriesHandled,
        a.avgResponseHour != null ? fmtHour(a.avgResponseHour) : '',
        a.overdueThreads,
      ]);
    }
    rows.push([]);
    rows.push(['— Funnel health by plan type —']);
    for (const c of funnels?.cohorts ?? []) {
      rows.push([]);
      rows.push([c.label, `${c.venueCount} venues`, `$${c.totalBookedValue.toLocaleString()} booked`]);
      rows.push(['Stage', 'Count', 'Step conversion %']);
      c.steps.forEach((s, i) => {
        rows.push([s.label, s.count, i > 0 ? (c.conversions[i - 1] ?? '') : '']);
      });
    }
    downloadCsv(`support-analytics_${range.from}_to_${range.to}.csv`, rows);
  }, [range, sortedLeaderboard, funnels]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Support Analytics</h2>
          <p className="text-xs text-gray-500">Concierge team performance and lead-funnel health, by plan cohort.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateRangePicker value={range} onChange={setRange} />
          <button
            type="button"
            onClick={exportCsv}
            disabled={!inbox || !funnels}
            className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-600 hover:text-gray-900 disabled:opacity-50"
          >
            <Download size={12} /> Export CSV
          </button>
          <button
            type="button"
            onClick={() => { void loadInbox(); void loadFunnels(); }}
            disabled={inboxLoading || funnelsLoading}
            className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-600 hover:text-gray-900 disabled:opacity-50"
          >
            <RefreshCw size={12} className={(inboxLoading || funnelsLoading) ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* ── Section: Concierge Team Performance ── */}
      <section className="space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-wide text-gray-500">Concierge Team Performance</h3>

        {inboxError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{inboxError}</div>
        )}

        {inboxLoading && !inbox && (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 size={20} className="animate-spin" />
          </div>
        )}

        {inbox && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <MetricCard icon={<Inbox size={14} />} label="Inquiries" value={inbox.summary.totalInquiries.toLocaleString()} sub="bride messages in range" />
              <MetricCard icon={<Reply size={14} />} label="Replies" value={inbox.summary.totalReplies.toLocaleString()} sub="concierge replies" />
              <MetricCard icon={<Percent size={14} />} label="Reply rate" value={`${inbox.summary.replyRate}%`} sub="inquiries answered" />
              <MetricCard icon={<Clock size={14} />} label="Avg / median response" value={fmtMinutes(inbox.summary.avgResponseMinutes)} sub={`median ${fmtMinutes(inbox.summary.medianResponseMinutes)}`} />
              <MetricCard icon={<AlertTriangle size={14} />} label="Overdue threads" value={inbox.summary.overdueThreadsCount.toLocaleString()} sub="SLA red / critical now" />
              <MetricCard icon={<MailQuestion size={14} />} label="Unanswered" value={inbox.summary.unansweredCount.toLocaleString()} sub="no reply in range" />
            </div>

            {/* After-hours badge */}
            <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3">
              <Moon size={15} className="text-indigo-500" />
              <span className="text-sm font-semibold text-gray-900">{inbox.afterHours.pct}%</span>
              <span className="text-xs text-gray-500">
                of concierge replies were sent after-hours (outside {inbox.afterHours.windowLabel}) — {inbox.afterHours.count.toLocaleString()} of {inbox.afterHours.total.toLocaleString()} replies.
              </span>
            </div>

            {/* Time-of-day histogram + day-of-week grouped bars */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <h4 className="mb-1 text-sm font-semibold text-gray-900">Reply time-of-day</h4>
                <p className="mb-3 text-[11px] text-gray-400">
                  When concierge replies go out (America/New_York) · avg {fmtHour(inbox.timeOfDay.avgHour)}
                </p>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={inbox.timeOfDay.hours.map((count, h) => ({ hour: h, label: fmtHourShort(h), count }))} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#94a3b8' }} interval={1} />
                    <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} allowDecimals={false} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} labelFormatter={(l) => `Hour: ${l}`} />
                    <Bar dataKey="count" fill="#1b1b1b" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <h4 className="mb-1 text-sm font-semibold text-gray-900">Inquiries vs. replies by day of week</h4>
                <p className="mb-3 text-[11px] text-gray-400">America/New_York calendar day</p>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={inbox.dayOfWeek} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} allowDecimals={false} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="inbound" name="Inquiries" fill="#6366f1" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="outbound" name="Replies" fill="#10b981" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Hour x day-of-week heatmap */}
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <h4 className="mb-1 text-sm font-semibold text-gray-900">Reply volume heatmap</h4>
              <p className="mb-3 text-[11px] text-gray-400">Concierge replies by hour (America/New_York) × day of week</p>
              <div className="overflow-x-auto">
                <div className="inline-block min-w-full">
                  <div className="grid gap-[2px]" style={{ gridTemplateColumns: `32px repeat(24, minmax(16px, 1fr))` }}>
                    <div />
                    {Array.from({ length: 24 }, (_, h) => (
                      <div key={h} className="text-center text-[8px] text-gray-400">{h % 3 === 0 ? fmtHourShort(h) : ''}</div>
                    ))}
                    {inbox.heatmap.map((row, dayIdx) => (
                      <Fragment key={dayIdx}>
                        <div className="flex items-center text-[10px] font-medium text-gray-500">
                          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayIdx]}
                        </div>
                        {row.map((v, h) => (
                          <div
                            key={`${dayIdx}-${h}`}
                            title={`${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayIdx]} ${fmtHourShort(h)}: ${v} repl${v === 1 ? 'y' : 'ies'}`}
                            className="aspect-square rounded-sm"
                            style={{ backgroundColor: v === 0 ? '#f3f4f6' : `rgba(27,27,27,${0.12 + 0.78 * (v / heatmapMax)})` }}
                          />
                        ))}
                      </Fragment>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* SLA trend */}
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <h4 className="mb-1 text-sm font-semibold text-gray-900">SLA trend</h4>
              <p className="mb-3 text-[11px] text-gray-400">% of unanswered threads in each SLA bucket, by day</p>
              {inbox.slaTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={inbox.slaTrend} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} tick={{ fontSize: 9, fill: '#94a3b8' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} unit="%" domain={[0, 100]} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Area type="monotone" dataKey="greenPct" name="Fresh (<24h)" stackId="sla" stroke={SLA_COLORS.green} fill={SLA_COLORS.green} fillOpacity={0.7} />
                    <Area type="monotone" dataKey="yellowPct" name="24–48h" stackId="sla" stroke={SLA_COLORS.yellow} fill={SLA_COLORS.yellow} fillOpacity={0.7} />
                    <Area type="monotone" dataKey="redPct" name="48–72h" stackId="sla" stroke={SLA_COLORS.red} fill={SLA_COLORS.red} fillOpacity={0.7} />
                    <Area type="monotone" dataKey="criticalPct" name="Critical (>72h)" stackId="sla" stroke={SLA_COLORS.critical} fill={SLA_COLORS.critical} fillOpacity={0.7} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <p className="py-10 text-center text-xs text-gray-400">Not enough history in this range.</p>
              )}
            </div>

            {/* Per-agent leaderboard */}
            <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-100 bg-gray-50">
                  <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                    <th className="px-4 py-2.5">Agent</th>
                    <th className="px-4 py-2.5 text-right">Replies</th>
                    <th className="px-4 py-2.5 text-right">Avg response</th>
                    <th className="px-4 py-2.5 text-right">Median response</th>
                    <th className="px-4 py-2.5 text-right">Reply rate</th>
                    <th className="px-4 py-2.5 text-right">Avg hour (ET)</th>
                    <th className="px-4 py-2.5 text-right">Overdue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sortedLeaderboard.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">No concierge activity in this range.</td></tr>
                  ) : sortedLeaderboard.map((a) => (
                    <tr key={a.agentId} className="hover:bg-gray-50/60">
                      <td className="px-4 py-3 font-medium text-gray-900">{a.name}</td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900 tabular-nums">{a.replies.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-gray-700 tabular-nums">{fmtMinutes(a.avgResponseMinutes)}</td>
                      <td className="px-4 py-3 text-right text-gray-700 tabular-nums">{fmtMinutes(a.medianResponseMinutes)}</td>
                      <td className="px-4 py-3 text-right text-gray-700 tabular-nums">{a.replyRate}%</td>
                      <td className="px-4 py-3 text-right text-gray-500 tabular-nums">{fmtHour(a.avgResponseHour)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {a.overdueThreads > 0 ? (
                          <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">{a.overdueThreads}</span>
                        ) : (
                          <span className="text-gray-300">0</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* ── Section: Funnel Health by Plan Type ── */}
      <section className="space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-wide text-gray-500">Funnel Health by Plan Type</h3>

        {funnelsError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{funnelsError}</div>
        )}

        {funnelsLoading && !funnels && (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 size={20} className="animate-spin" />
          </div>
        )}

        {funnels && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {funnels.cohorts.map((c) => (
              <CohortFunnelCard key={c.key} cohort={c} onStageClick={openDrill} />
            ))}
          </div>
        )}
      </section>

      {/* Drill-down modal */}
      {drill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDrill(null)}>
          <div className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between border-b border-gray-100 px-4 py-3">
              <div>
                <h4 className="text-sm font-semibold text-gray-900">{drill.cohortLabel} — {drill.stageLabel}</h4>
                <p className="text-xs text-gray-500">Venues at or past this stage · leads created {range.from} to {range.to}</p>
              </div>
              <button onClick={() => setDrill(null)} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-2">
              {drillLoading && (
                <div className="flex items-center justify-center gap-2 py-8 text-gray-400">
                  <Loader2 size={16} className="animate-spin" /> <span className="text-sm">Loading…</span>
                </div>
              )}
              {drillError && <p className="m-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{drillError}</p>}
              {!drillLoading && !drillError && drillVenues && drillVenues.length === 0 && (
                <p className="px-3 py-8 text-center text-sm text-gray-400">No venues at this stage.</p>
              )}
              {!drillLoading && drillVenues && drillVenues.length > 0 && (
                <ul className="divide-y divide-gray-100">
                  {drillVenues.map((v) => (
                    <li key={v.id} className="flex items-center justify-between gap-3 px-2 py-2">
                      <span className="truncate text-sm font-medium text-gray-900">{v.name}</span>
                      <span className="shrink-0 text-xs text-gray-500 tabular-nums">
                        {v.countAtOrPastStage.toLocaleString()} / {v.leadCount.toLocaleString()} leads
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Cohort mini-funnel card ────────────────────────────────────────────────

function CohortFunnelCard({ cohort, onStageClick }: { cohort: CohortFunnel; onStageClick: (cohort: CohortFunnel, step: FunnelStep) => void }) {
  const top = Math.max(1, cohort.steps[0]?.count ?? 0);

  if (cohort.venueCount === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-gray-900">{cohort.label}</h4>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">0 venues</span>
        </div>
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
          <Sparkles size={20} className="text-gray-300" />
          <p className="text-xs text-gray-400">No venues in this cohort yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-1 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-900">{cohort.label}</h4>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
          {cohort.venueCount} venue{cohort.venueCount === 1 ? '' : 's'}
        </span>
      </div>
      <p className="mb-3 text-[11px] text-gray-400">
        {cohort.leadToWonPct != null ? `${cohort.leadToWonPct}% lead → won` : 'No leads yet'}
        {cohort.totalBookedValue > 0 && <> · {fmtMoney(cohort.totalBookedValue)} booked</>}
      </p>

      <div className="space-y-2.5">
        {cohort.steps.map((s, i) => {
          const widthPct = s.count === 0 ? 0 : Math.max(3, (s.count / top) * 100);
          return (
            <div key={s.key}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-medium text-gray-700">{s.label}</span>
                <span className="tabular-nums text-gray-500">
                  <span className="font-semibold text-gray-900">{s.count.toLocaleString()}</span>
                  {i > 0 && cohort.conversions[i - 1] != null && (
                    <span className="ml-1.5 text-gray-400">{cohort.conversions[i - 1]}% from prev</span>
                  )}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onStageClick(cohort, s)}
                disabled={s.count === 0}
                title={`See venues at/past "${s.label}"`}
                className="group h-7 w-full overflow-hidden rounded-md bg-gray-100 text-left transition-shadow hover:ring-2 hover:ring-indigo-300 disabled:cursor-not-allowed disabled:hover:ring-0"
              >
                <div
                  className="flex h-full items-center rounded-md px-2 text-[11px] font-semibold text-white transition-all"
                  style={{ width: `${widthPct}%`, backgroundColor: STAGE_COLORS[i % STAGE_COLORS.length] }}
                >
                  {widthPct > 14 ? s.count.toLocaleString() : ''}
                </div>
              </button>
            </div>
          );
        })}
      </div>

      {cohort.biggestDropOff && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
          <TrendingDown size={11} className="mr-0.5 inline" />
          Biggest drop-off: <strong>{cohort.biggestDropOff.fromLabel} → {cohort.biggestDropOff.toLabel}</strong>{' '}
          ({cohort.biggestDropOff.dropCount.toLocaleString()} lost{cohort.biggestDropOff.stepConversion != null ? `, only ${cohort.biggestDropOff.stepConversion}% continue` : ''}).
        </p>
      )}
    </div>
  );
}
