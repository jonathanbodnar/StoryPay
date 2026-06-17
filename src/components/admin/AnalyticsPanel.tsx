'use client';

/**
 * AnalyticsPanel — super-admin "Usage Analytics" tab.
 *
 * Visualizes product usage captured in `analytics_events`: top-line metrics,
 * the signup→activation funnel (where venues drop off), top pages, top clicked
 * elements (what people are most interested in), feature trending vs the prior
 * period, a daily activity time-series, and a live recent-activity feed.
 *
 * Data: GET /api/admin/analytics?days=N. No heatmaps — just metrics, pie/bar
 * charts, and a live feed, per the simple-first brief.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Loader2, RefreshCw, TrendingUp, TrendingDown, Minus,
  MousePointerClick, Eye, Users, Building2, UserPlus, Activity,
  ChevronLeft, ChevronRight, X, Search, List,
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell,
} from 'recharts';

const BRAND = '#1b1b1b';
const PIE_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#ef4444', '#84cc16', '#a855f7', '#14b8a6', '#f97316', '#3b82f6'];

interface FunnelStep { event: string; label: string; count: number; pct: number; }
interface TrendItem { event: string; count: number; prev: number; delta: number; }
interface RecentRow {
  id: string; created_at: string; event: string; kind: string;
  venue_id: string | null; user_email: string | null; role: string | null;
  path: string | null; label: string | null;
}
interface AnalyticsData {
  window: { days: number; sinceIso: string };
  totals: { events: number; pageviews: number; clicks: number; activeVenues: number; activeSessions: number; signups: number };
  funnel: FunnelStep[];
  topPages: { path: string; count: number }[];
  topClicks: { label: string; count: number }[];
  trending: TrendItem[];
  timeseries: { day: string; count: number }[];
  recent: RecentRow[];
  venueNames: Record<string, string>;
}

const DAY_OPTIONS = [
  { label: '24h', days: 1 },
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: 'All', days: 0 },
];

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function prettyEvent(e: string): string {
  return e.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
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

export default function AnalyticsPanel() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [activityModalOpen, setActivityModalOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/analytics?days=${days}`, { cache: 'no-store' });
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
  }, [days]);

  useEffect(() => { void load(); }, [load]);

  const funnelMax = useMemo(
    () => Math.max(1, ...(data?.funnel.map((f) => f.count) ?? [1])),
    [data],
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Usage Analytics</h2>
          <p className="text-xs text-gray-500">What people are doing — clicks, pages, funnel & trends.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-gray-200 bg-white p-0.5">
            {DAY_OPTIONS.map((o) => (
              <button
                key={o.label}
                type="button"
                onClick={() => setDays(o.days)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  days === o.days ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
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
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 size={20} className="animate-spin" />
        </div>
      )}

      {data && (
        <>
          {/* Metric cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <MetricCard icon={<UserPlus size={14} />}            label="Signups"        value={data.totals.signups.toLocaleString()} sub="all time" />
            <MetricCard icon={<Building2 size={14} />}           label="Active venues"  value={data.totals.activeVenues.toLocaleString()} sub="in window" />
            <MetricCard icon={<Users size={14} />}               label="Sessions"       value={data.totals.activeSessions.toLocaleString()} />
            <MetricCard icon={<Activity size={14} />}            label="Events"         value={data.totals.events.toLocaleString()} />
            <MetricCard icon={<Eye size={14} />}                 label="Pageviews"      value={data.totals.pageviews.toLocaleString()} />
            <MetricCard icon={<MousePointerClick size={14} />}   label="Clicks"         value={data.totals.clicks.toLocaleString()} />
          </div>

          {/* Funnel + time series */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <h3 className="mb-3 text-sm font-semibold text-gray-900">Signup → Activation funnel</h3>
              <div className="space-y-2.5">
                {data.funnel.map((f, i) => (
                  <div key={f.event}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="font-medium text-gray-700">{f.label}</span>
                      <span className="text-gray-500">
                        <strong className="text-gray-900">{f.count.toLocaleString()}</strong>
                        {i > 0 && <span className="ml-1.5 text-gray-400">{f.pct}%</span>}
                      </span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${Math.max(2, (f.count / funnelMax) * 100)}%`, backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                      />
                    </div>
                  </div>
                ))}
                {data.funnel.every((f) => f.count === 0) && (
                  <p className="py-6 text-center text-xs text-gray-400">No funnel data yet — milestones appear as venues sign up and activate.</p>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <h3 className="mb-3 text-sm font-semibold text-gray-900">Activity over time</h3>
              {data.timeseries.length > 0 ? (
                <ResponsiveContainer width="100%" height={210}>
                  <AreaChart data={data.timeseries} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="usageFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={BRAND} stopOpacity={0.18} />
                        <stop offset="100%" stopColor={BRAND} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} allowDecimals={false} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    <Area type="monotone" dataKey="count" stroke={BRAND} strokeWidth={2} fill="url(#usageFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <p className="py-16 text-center text-xs text-gray-400">No activity in this window yet.</p>
              )}
            </div>
          </div>

          {/* Pie charts: top pages + top clicks */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <TopBreakdown title="Most visited pages" emptyHint="No pageviews yet." items={data.topPages.map((p) => ({ name: p.path, value: p.count }))} />
            <TopBreakdown title="Most clicked elements" emptyHint="No clicks captured yet." items={data.topClicks.map((c) => ({ name: c.label, value: c.count }))} />
          </div>

          {/* Trending + live feed */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <h3 className="mb-3 text-sm font-semibold text-gray-900">Trending vs previous period</h3>
              {data.trending.length > 0 ? (
                <div className="space-y-1.5">
                  {data.trending.map((t) => (
                    <div key={t.event} className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-gray-50">
                      <span className="text-xs font-medium text-gray-700">{prettyEvent(t.event)}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-gray-500">{t.count.toLocaleString()}</span>
                        <span className={`flex items-center gap-0.5 text-xs font-semibold ${
                          t.delta > 0 ? 'text-emerald-600' : t.delta < 0 ? 'text-red-500' : 'text-gray-400'
                        }`}>
                          {t.delta > 0 ? <TrendingUp size={12} /> : t.delta < 0 ? <TrendingDown size={12} /> : <Minus size={12} />}
                          {t.delta > 0 ? '+' : ''}{t.delta}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-10 text-center text-xs text-gray-400">Not enough history to compare yet.</p>
              )}
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">Live activity</h3>
                <button
                  type="button"
                  onClick={() => setActivityModalOpen(true)}
                  className="flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-gray-500 hover:border-gray-300 hover:text-gray-800 transition-colors"
                >
                  <List size={11} /> View all
                </button>
              </div>
              <div className="space-y-1">
                {data.recent.length > 0 ? data.recent.slice(0, 12).map((r) => (
                  <ActivityRow key={r.id} r={r} venueName={r.venue_id ? (data.venueNames[r.venue_id] || 'venue') : 'anon'} />
                )) : (
                  <p className="py-10 text-center text-xs text-gray-400">No recent activity.</p>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {activityModalOpen && (
        <ActivityModal onClose={() => setActivityModalOpen(false)} />
      )}
    </div>
  );
}

// ─── Shared activity row ──────────────────────────────────────────────────────

function eventBadge(r: { kind: string; event: string }) {
  if (r.kind === 'milestone') return 'bg-violet-100 text-violet-700';
  if (r.event === 'click')    return 'bg-sky-50 text-sky-600';
  if (r.event === 'rage_click') return 'bg-red-100 text-red-600';
  if (r.event === 'session_start') return 'bg-emerald-50 text-emerald-700';
  return 'bg-gray-100 text-gray-500';
}

function eventLabel(e: string) {
  if (e === 'click')         return 'click';
  if (e === 'pageview')      return 'view';
  if (e === 'rage_click')    return 'rage';
  if (e === 'session_start') return 'session';
  return prettyEvent(e);
}

function ActivityRow({ r, venueName }: { r: RecentRow; venueName: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-gray-50 py-1.5 text-xs last:border-0">
      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${eventBadge(r)}`}>
        {eventLabel(r.event)}
      </span>
      <span className="min-w-0 flex-1 truncate text-gray-700" title={r.label || r.path || ''}>
        {r.label || r.path || '—'}
      </span>
      <span className="shrink-0 text-gray-400 text-[11px]">{venueName}</span>
      <span className="shrink-0 text-gray-300 text-[11px]">{relativeTime(r.created_at)}</span>
    </div>
  );
}

// ─── Full-history activity modal ──────────────────────────────────────────────

const PAGE_SIZE = 50;

interface ActivityPage {
  rows: (RecentRow & { session_id?: string | null; properties?: Record<string, unknown> | null })[];
  total: number;
  venueNames: Record<string, string>;
}

function ActivityModal({ onClose }: { onClose: () => void }) {
  const [page, setPage]     = useState(0);
  const [q, setQ]           = useState('');
  const [kind, setKind]     = useState('');
  const [data, setData]     = useState<ActivityPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const inputRef            = useRef<HTMLInputElement>(null);
  const scrollRef           = useRef<HTMLDivElement>(null);

  const load = useCallback(async (pg: number, search: string, kindFilter: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit:  String(PAGE_SIZE),
        offset: String(pg * PAGE_SIZE),
      });
      if (kindFilter) params.set('kind', kindFilter);
      if (search.trim()) params.set('q', search.trim());
      const r = await fetch(`/api/admin/analytics/activity?${params.toString()}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`Failed (${r.status})`);
      setData(await r.json() as ActivityPage);
      scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(0, '', ''); requestAnimationFrame(() => inputRef.current?.focus()); }, [load]);

  // Debounced search
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSearch = (v: string) => {
    setQ(v);
    setPage(0);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => void load(0, v, kind), 350);
  };

  const onKind = (v: string) => { setKind(v); setPage(0); void load(0, q, v); };

  const goTo = (pg: number) => { setPage(pg); void load(pg, q, kind); };

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  const modal = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative flex w-full max-w-3xl flex-col rounded-2xl border border-gray-200 bg-white shadow-2xl"
           style={{ maxHeight: '90vh' }}>
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-100 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Activity size={15} className="text-gray-400" />
            <h2 className="text-sm font-semibold text-gray-900">All activity</h2>
            {data && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">
                {data.total.toLocaleString()} events
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <X size={14} />
          </button>
        </div>

        {/* Filters */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-100 px-5 py-2.5">
          <div className="relative min-w-0 flex-1">
            <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              ref={inputRef}
              value={q}
              onChange={e => onSearch(e.target.value)}
              placeholder="Search event, label, path…"
              className="w-full rounded-lg border border-gray-200 py-1.5 pl-7 pr-3 text-xs outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-200"
            />
          </div>
          <select
            value={kind}
            onChange={e => onKind(e.target.value)}
            className="rounded-lg border border-gray-200 py-1.5 pl-2.5 pr-7 text-xs text-gray-600 outline-none focus:border-gray-400"
          >
            <option value="">All types</option>
            <option value="milestone">Milestones</option>
            <option value="auto">Auto-capture</option>
          </select>
        </div>

        {/* Table */}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          {error && (
            <div className="m-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
          )}
          {loading && (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <Loader2 size={18} className="animate-spin" />
            </div>
          )}
          {!loading && data && (
            <>
              {/* Column headers */}
              <div className="sticky top-0 grid grid-cols-[80px_1fr_140px_120px_100px] gap-2 border-b border-gray-100 bg-gray-50/90 px-5 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400 backdrop-blur-sm">
                <span>Type</span>
                <span>Label / Path</span>
                <span>Venue</span>
                <span>Session</span>
                <span className="text-right">Time</span>
              </div>
              {data.rows.length === 0 ? (
                <p className="py-16 text-center text-xs text-gray-400">No events match your filters.</p>
              ) : (
                data.rows.map(r => (
                  <div key={r.id}
                    className="grid grid-cols-[80px_1fr_140px_120px_100px] gap-2 border-b border-gray-50 px-5 py-2 text-xs hover:bg-gray-50/60 last:border-0"
                  >
                    <span className={`self-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${eventBadge(r)}`}>
                      {eventLabel(r.event)}
                    </span>
                    <span className="self-center min-w-0 truncate text-gray-700" title={r.label || r.path || ''}>
                      {r.label || r.path || <span className="text-gray-300">—</span>}
                    </span>
                    <span className="self-center min-w-0 truncate text-gray-400">
                      {r.venue_id ? (data.venueNames[r.venue_id] || r.venue_id.slice(0, 8)) : 'anon'}
                    </span>
                    <span className="self-center min-w-0 truncate text-gray-300 font-mono text-[10px]">
                      {r.session_id ? r.session_id.slice(0, 14) : '—'}
                    </span>
                    <span className="self-center text-right text-gray-300 text-[11px]">
                      {relativeTime(r.created_at)}
                    </span>
                  </div>
                ))
              )}
            </>
          )}
        </div>

        {/* Pagination footer */}
        {data && totalPages > 1 && (
          <div className="flex shrink-0 items-center justify-between border-t border-gray-100 px-5 py-3">
            <span className="text-[11px] text-gray-400">
              {(page * PAGE_SIZE + 1).toLocaleString()}–{Math.min((page + 1) * PAGE_SIZE, data.total).toLocaleString()} of {data.total.toLocaleString()}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => goTo(page - 1)}
                disabled={page === 0 || loading}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-800 disabled:opacity-40"
              >
                <ChevronLeft size={13} />
              </button>

              {/* Page number pills */}
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                const pg = totalPages <= 7 ? i
                  : page < 4 ? i
                  : page > totalPages - 5 ? totalPages - 7 + i
                  : page - 3 + i;
                return (
                  <button
                    key={pg}
                    type="button"
                    onClick={() => goTo(pg)}
                    disabled={loading}
                    className={`flex h-7 min-w-[28px] items-center justify-center rounded-lg border px-2 text-[11px] font-medium transition-colors ${
                      pg === page
                        ? 'border-gray-900 bg-gray-900 text-white'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-800'
                    }`}
                  >
                    {pg + 1}
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => goTo(page + 1)}
                disabled={page >= totalPages - 1 || loading}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-800 disabled:opacity-40"
              >
                <ChevronRight size={13} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(modal, document.body);
}

// ─── TopBreakdown ─────────────────────────────────────────────────────────────

function TopBreakdown({ title, items, emptyHint }: { title: string; items: { name: string; value: number }[]; emptyHint: string }) {
  const total = items.reduce((s, i) => s + i.value, 0);
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-gray-900">{title}</h3>
      {items.length > 0 ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="shrink-0">
            <ResponsiveContainer width={140} height={140}>
              <PieChart>
                <Pie data={items} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={34} outerRadius={64} paddingAngle={2}>
                  {items.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            {items.slice(0, 8).map((it, i) => (
              <div key={it.name} className="flex items-center gap-2 text-xs">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                <span className="min-w-0 flex-1 truncate text-gray-700" title={it.name}>{it.name}</span>
                <span className="shrink-0 font-medium text-gray-900">{it.value}</span>
                <span className="shrink-0 text-gray-400">{total > 0 ? Math.round((it.value / total) * 100) : 0}%</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="py-10 text-center text-xs text-gray-400">{emptyHint}</p>
      )}
    </div>
  );
}
