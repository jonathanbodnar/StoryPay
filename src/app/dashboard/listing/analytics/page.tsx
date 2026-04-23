'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import {
  Eye, Users, MousePointerClick, TrendingUp,
  Smartphone, Monitor, Tablet, MapPin,
  RefreshCw, CheckCircle, AlertCircle, Clock,
  ArrowUpRight, ArrowDownRight, Minus, Search,
  Radio, DollarSign, CalendarDays, UserCheck,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell,
} from 'recharts';

// ── Types ─────────────────────────────────────────────────────────────────────

type FunnelStep = { step: string; count: number; pct: number | null };

type PriorMetrics = {
  total_views: number;
  unique_sessions: number;
  contact_form_submits: number;
  leads_created: number;
  conversion_rate: number;
};

type AnalyticsPayload = {
  days: number;
  gallery_images: string[];
  total_views: number;
  total_impressions: number;
  unique_sessions: number;
  total_interactions: number;
  conversion_rate: number;
  contact_form_opens: number;
  contact_form_submits: number;
  leads_created: number;
  avg_session_duration: number;
  daily: { date: string; views: number; unique_sessions: number; impressions: number }[];
  event_counts: Record<string, number>;
  scroll_depth: { pct_25: number; pct_50: number; pct_75: number; pct_100: number };
  devices: Record<string, number>;
  referrers: { source: string; count: number }[];
  top_countries: { country: string; count: number }[];
  top_cities: { city: string; count: number }[];
  inquiry_dow: number[];
  photo_views: { index: number; count: number }[];
  social_clicks: Record<string, number>;
  funnel: FunnelStep[];
  prior: PriorMetrics;
  _migration_pending?: boolean;
};

// ── Realtime + lead insight types ─────────────────────────────────────────────
type RealtimePayload = {
  active_5m: number;
  active_30m: number;
  today_views: number;
  activity: {
    session_id: string;
    event_type: string;
    label: string;
    country: string | null;
    city: string | null;
    flag: string;
    device_type: string | null;
    ago_seconds: number;
  }[];
  geo_live: { country: string; flag: string; count: number; cities: string[] }[];
  _migration_pending?: boolean;
};

type LeadInsightsPayload = {
  total_leads: number;
  avg_guest_count: number | null;
  avg_opportunity_value: number | null;
  guest_buckets: { label: string; count: number }[];
  sources: { source: string; count: number }[];
  event_months: { month: string; count: number }[];
  value_buckets: { label: string; count: number }[];
  timelines: { label: string; count: number }[];
  lead_trend: { month: string; count: number }[];
};

// ── Constants ─────────────────────────────────────────────────────────────────
const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_OPTIONS = [1, 7, 14, 30, 60, 90];
const CHART_BLUE  = '#3b82f6';
const CHART_DARK  = '#1b1b1b';

// ── Helpers ───────────────────────────────────────────────────────────────────

function delta(current: number, prior: number): number | null {
  if (!prior) return null;
  return Math.round(((current - prior) / prior) * 100);
}

function fmtDuration(seconds: number): string {
  if (!seconds) return '—';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtAgo(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function fmtCents(cents: number | null): string {
  if (!cents) return '—';
  return `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function DeltaBadge({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  if (pct === 0) return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">
      <Minus size={9} /> 0%
    </span>
  );
  const up = pct > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${up ? 'text-emerald-700 bg-emerald-100' : 'text-red-600 bg-red-100'}`}>
      {up ? <ArrowUpRight size={9} /> : <ArrowDownRight size={9} />}
      {Math.abs(pct)}%
    </span>
  );
}

function KpiCard({
  icon: Icon, label, value, sub, deltaVal, color = 'gray',
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  deltaVal?: number | null;
  color?: 'gray' | 'blue' | 'green' | 'purple' | 'amber' | 'rose';
}) {
  const bg = { gray: 'bg-white', blue: 'bg-blue-50', green: 'bg-emerald-50', purple: 'bg-purple-50', amber: 'bg-amber-50', rose: 'bg-rose-50' }[color];
  const border = { gray: 'border-gray-200', blue: 'border-blue-100', green: 'border-emerald-100', purple: 'border-purple-100', amber: 'border-amber-100', rose: 'border-rose-100' }[color];
  const iconColor = { gray: 'text-gray-400', blue: 'text-blue-500', green: 'text-emerald-500', purple: 'text-purple-500', amber: 'text-amber-500', rose: 'text-rose-500' }[color];
  return (
    <div className={`rounded-2xl border p-5 ${bg} ${border}`}>
      <div className="flex items-start justify-between mb-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{label}</p>
        <Icon size={16} className={iconColor} />
      </div>
      <p className="text-3xl font-bold text-gray-900 mb-1">{value}</p>
      <div className="flex items-center gap-2 flex-wrap">
        {sub && <p className="text-[11px] text-gray-400">{sub}</p>}
        {deltaVal !== undefined && <DeltaBadge pct={deltaVal} />}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-semibold text-gray-900">{children}</h2>;
}

function EmptyState({ message }: { message: string }) {
  return <p className="py-6 text-center text-xs text-gray-400">{message}</p>;
}

function MiniBarRow({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-xs text-gray-600 truncate">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full rounded-full bg-gray-800 transition-all" style={{ width: max ? `${(value / max) * 100}%` : '0%' }} />
      </div>
      <span className="w-8 text-right text-xs font-semibold text-gray-700 shrink-0">{value}</span>
    </div>
  );
}

function ScrollBar({ label, pct }: { label: string; pct: number }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-gray-500">{label}</span>
        <span className="font-semibold text-gray-800">{pct}%</span>
      </div>
      <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${CHART_BLUE}, #1d4ed8)` }} />
      </div>
    </div>
  );
}

// Recharts custom tooltip
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number; name: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-lg text-xs">
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} className="text-gray-600">{p.name}: <span className="font-bold text-gray-900">{p.value}</span></p>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ListingAnalyticsPage() {
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [error, setError] = useState('');

  const [rt, setRt] = useState<RealtimePayload | null>(null);
  const [rtLoading, setRtLoading] = useState(true);
  const rtInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const [insights, setInsights] = useState<LeadInsightsPayload | null>(null);

  async function load(d: number) {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/listing-analytics?days=${d}`);
      if (!res.ok) { setError('Could not load analytics'); return; }
      setData(await res.json() as AnalyticsPayload);
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  async function loadRealtime() {
    try {
      const res = await fetch('/api/listing-analytics/realtime');
      if (res.ok) setRt(await res.json() as RealtimePayload);
    } catch { /* silent */ } finally {
      setRtLoading(false);
    }
  }

  async function loadInsights() {
    try {
      const res = await fetch('/api/listing-analytics/lead-insights?days=365');
      if (res.ok) setInsights(await res.json() as LeadInsightsPayload);
    } catch { /* silent */ }
  }

  useEffect(() => { void load(days); }, [days]);

  useEffect(() => {
    void loadRealtime();
    void loadInsights();
    rtInterval.current = setInterval(() => void loadRealtime(), 30000);
    return () => { if (rtInterval.current) clearInterval(rtInterval.current); };
  }, []);

  const totalDevices = data ? Object.values(data.devices).reduce((a, b) => a + b, 0) : 0;
  const hasImpressions = (data?.total_impressions ?? 0) > 0;

  // Build photo map: index → url
  const photoMap: Record<number, string> = {};
  data?.gallery_images.forEach((url, i) => { photoMap[i] = url; });

  const d = data;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 space-y-8">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Listing Analytics</h1>
          <p className="mt-0.5 text-sm text-gray-500">How visitors find and engage with your listing</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl border border-gray-200 bg-white overflow-hidden">
            {DAYS_OPTIONS.map(opt => (
              <button key={opt} onClick={() => setDays(opt)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${days === opt ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
                {opt}d
              </button>
            ))}
          </div>
          <button onClick={() => void load(days)} disabled={loading}
            className="p-2 rounded-xl border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 disabled:opacity-40 transition-colors">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── Status banners ─────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={15} /> {error}
        </div>
      )}
      {d?._migration_pending && (
        <div className="flex items-start gap-3 rounded-2xl bg-amber-50 border border-amber-100 px-5 py-4">
          <AlertCircle size={18} className="text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-900">Database migration pending</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Run migration <code className="font-mono">056_listing_analytics.sql</code> in your Supabase SQL editor to start collecting data.
            </p>
          </div>
        </div>
      )}
      {!d?._migration_pending && !loading && d && (
        <div className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-2.5 text-sm text-emerald-700">
          <CheckCircle size={14} /> Tracking active — collecting data from your public listing
        </div>
      )}

      {/* ── Realtime panel ─────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
            </span>
            <h2 className="text-sm font-semibold text-gray-900">Live right now</h2>
            <span className="text-xs text-gray-400">· auto-refreshes every 30s</span>
          </div>
          <button onClick={() => { setRtLoading(true); void loadRealtime(); }} disabled={rtLoading}
            className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-50 disabled:opacity-40 transition-colors">
            <RefreshCw size={13} className={rtLoading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Live stats */}
        <div className="grid grid-cols-3 divide-x divide-gray-100">
          {[
            { label: 'Active now', value: rt?.active_5m ?? '—', sub: 'last 5 min' },
            { label: 'Active today', value: rt?.today_views ?? '—', sub: 'page views' },
            { label: 'Last 30 min', value: rt?.active_30m ?? '—', sub: 'unique sessions' },
          ].map(({ label, value, sub }) => (
            <div key={label} className="px-6 py-4 text-center">
              <p className="text-2xl font-bold text-gray-900">{value}</p>
              <p className="text-[11px] font-semibold text-gray-500 mt-0.5">{label}</p>
              <p className="text-[10px] text-gray-400">{sub}</p>
            </div>
          ))}
        </div>

        {/* Activity feed + geo side by side */}
        {rt && !rt._migration_pending && (rt.activity.length > 0 || rt.geo_live.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-100">

            {/* Activity feed */}
            <div className="px-5 py-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Recent activity</p>
              {rt.activity.length > 0 ? (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {rt.activity.map((a, i) => (
                    <div key={i} className="flex items-center gap-3 py-1.5">
                      <span className="text-lg leading-none">{a.flag}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-800 truncate">{a.label}</p>
                        <p className="text-[10px] text-gray-400 truncate">
                          {[a.city, a.country].filter(Boolean).join(', ') || 'Unknown location'}
                          {a.device_type ? ` · ${a.device_type}` : ''}
                        </p>
                      </div>
                      <span className="text-[10px] text-gray-400 shrink-0">{fmtAgo(a.ago_seconds)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400 py-4 text-center">No activity in the last 30 minutes</p>
              )}
            </div>

            {/* Live geo breakdown */}
            <div className="px-5 py-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Where visitors are right now</p>
              {rt.geo_live.length > 0 ? (
                <div className="space-y-2">
                  {rt.geo_live.map(g => (
                    <div key={g.country} className="flex items-center gap-3">
                      <span className="text-lg leading-none w-6 shrink-0">{g.flag}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-800">{g.country}</p>
                        {g.cities.length > 0 && (
                          <p className="text-[10px] text-gray-400 truncate">{g.cities.join(', ')}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                          <div className="h-full rounded-full bg-emerald-400"
                            style={{ width: `${rt.geo_live[0] ? (g.count / rt.geo_live[0].count) * 100 : 0}%` }} />
                        </div>
                        <span className="text-[11px] font-semibold text-gray-600 w-5 text-right">{g.count}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400 py-4 text-center">No location data available yet</p>
              )}
            </div>
          </div>
        )}

        {rt?._migration_pending && (
          <div className="px-6 py-4 text-xs text-gray-400 text-center">
            Run migration 056_listing_analytics.sql to enable live tracking
          </div>
        )}
      </div>

      {/* ── Loading skeletons ───────────────────────────────────────────── */}
      {loading && !d && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-2xl border border-gray-200 bg-white p-5 h-28 animate-pulse">
              <div className="h-3 w-20 bg-gray-100 rounded mb-3" /><div className="h-8 w-16 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
      )}

      {d && (
        <>
          {/* ── KPI Cards ────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard icon={Eye} label="Listing views" value={d.total_views.toLocaleString()}
              sub={`vs ${d.prior.total_views} prior`}
              deltaVal={delta(d.total_views, d.prior.total_views)} color="blue" />
            <KpiCard icon={Users} label="Unique visitors" value={d.unique_sessions.toLocaleString()}
              sub={`vs ${d.prior.unique_sessions} prior`}
              deltaVal={delta(d.unique_sessions, d.prior.unique_sessions)} color="purple" />
            <KpiCard icon={MousePointerClick} label="Inquiries sent" value={d.contact_form_submits.toLocaleString()}
              sub={`${d.leads_created} leads created`}
              deltaVal={delta(d.contact_form_submits, d.prior.contact_form_submits)} color="green" />
            <KpiCard icon={TrendingUp} label="Conversion rate" value={`${d.conversion_rate}%`}
              sub="Views → inquiry"
              deltaVal={delta(d.conversion_rate, d.prior.conversion_rate)} color="amber" />
          </div>

          {/* Avg session duration + impressions */}
          <div className="grid grid-cols-2 gap-4">
            <KpiCard icon={Clock} label="Avg time on listing" value={fmtDuration(d.avg_session_duration)}
              sub="Per engaged session" color="rose" />
            <KpiCard icon={Search} label="Search impressions"
              value={hasImpressions ? d.total_impressions.toLocaleString() : '—'}
              sub={hasImpressions ? 'Times seen in search results' : 'Tracked when directory search launches'}
              color="gray" />
          </div>

          {/* ── Views + Unique visitors chart ────────────────────────────── */}
          <div className="rounded-2xl border border-gray-200 bg-white p-6">
            <SectionTitle>Daily views — last {days} days</SectionTitle>
            <p className="text-xs text-gray-400 mt-0.5 mb-5">Total page views vs unique visitors each day</p>
            {d.daily.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={d.daily.map(row => ({ ...row, date: formatDate(row.date) }))}
                  margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="viewsGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART_BLUE} stopOpacity={0.2} />
                      <stop offset="100%" stopColor={CHART_BLUE} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="sessionsGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART_DARK} stopOpacity={0.12} />
                      <stop offset="100%" stopColor={CHART_DARK} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="views" name="Views" stroke={CHART_BLUE} strokeWidth={2} fill="url(#viewsGrad)" dot={false} activeDot={{ r: 4 }} />
                  <Area type="monotone" dataKey="unique_sessions" name="Unique visitors" stroke={CHART_DARK} strokeWidth={1.5} strokeDasharray="4 2" fill="url(#sessionsGrad)" dot={false} activeDot={{ r: 3 }} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message="No view data yet — visit your public listing to test tracking." />
            )}
          </div>

          {/* ── Conversion Funnel ────────────────────────────────────────── */}
          {d.funnel.length > 0 && (
            <div className="rounded-2xl border border-gray-200 bg-white p-6">
              <SectionTitle>Conversion funnel</SectionTitle>
              <p className="text-xs text-gray-400 mt-0.5 mb-5">How visitors move from discovery to inquiry</p>
              <div className="space-y-2">
                {d.funnel.map((step, i) => {
                  const maxCount = d.funnel[0]?.count || 1;
                  const barPct = maxCount ? (step.count / maxCount) * 100 : 0;
                  const colors = ['bg-blue-600', 'bg-blue-500', 'bg-indigo-500', 'bg-violet-500', 'bg-purple-500', 'bg-emerald-500'];
                  return (
                    <div key={step.step} className="flex items-center gap-4">
                      <span className="w-32 shrink-0 text-xs text-gray-600 font-medium">{step.step}</span>
                      <div className="flex-1 h-8 rounded-lg bg-gray-100 overflow-hidden relative">
                        <div className={`h-full rounded-lg transition-all ${colors[i] ?? 'bg-gray-400'}`}
                          style={{ width: `${barPct}%` }} />
                        <span className="absolute inset-0 flex items-center px-3 text-xs font-bold text-white mix-blend-darken" style={{ color: barPct > 20 ? '#fff' : '#374151' }}>
                          {step.count.toLocaleString()}
                        </span>
                      </div>
                      {step.pct !== null && (
                        <span className="w-14 shrink-0 text-right text-xs text-gray-400">{step.pct}% CTR</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Scroll depth + Engagement ────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-gray-200 bg-white p-6 space-y-3">
              <SectionTitle>Scroll depth</SectionTitle>
              <p className="text-xs text-gray-400">% of visitors who scroll this far</p>
              <ScrollBar label="25% of page"    pct={d.scroll_depth.pct_25} />
              <ScrollBar label="50% of page"    pct={d.scroll_depth.pct_50} />
              <ScrollBar label="75% of page"    pct={d.scroll_depth.pct_75} />
              <ScrollBar label="Bottom of page" pct={d.scroll_depth.pct_100} />
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-6 space-y-3">
              <SectionTitle>Engagement breakdown</SectionTitle>
              {[
                { label: 'Photo views',   value: d.event_counts['photo_view'] ?? 0 },
                { label: 'FAQ opens',     value: d.event_counts['faq_open'] ?? 0 },
                { label: 'Map clicks',    value: d.event_counts['map_click'] ?? 0 },
                { label: 'Social clicks', value: d.event_counts['social_click'] ?? 0 },
                { label: 'Form opens',    value: d.event_counts['contact_form_open'] ?? 0 },
                { label: 'Form submits',  value: d.event_counts['contact_form_submit'] ?? 0 },
              ].map(item => (
                <MiniBarRow key={item.label} {...item}
                  max={Math.max(...[
                    d.event_counts['photo_view'] ?? 0,
                    d.event_counts['faq_open'] ?? 0,
                    d.event_counts['map_click'] ?? 0,
                    d.event_counts['social_click'] ?? 0,
                    d.event_counts['contact_form_open'] ?? 0,
                    d.event_counts['contact_form_submit'] ?? 0,
                  ], 1)} />
              ))}
            </div>
          </div>

          {/* ── Traffic sources + devices ────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-gray-200 bg-white p-6 space-y-3">
              <SectionTitle>Traffic sources</SectionTitle>
              {d.referrers.length > 0
                ? d.referrers.map(r => <MiniBarRow key={r.source} label={r.source} value={r.count} max={d.referrers[0]?.count ?? 1} />)
                : <EmptyState message="No data yet" />}
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-6 space-y-4">
              <SectionTitle>Devices</SectionTitle>
              {totalDevices > 0 ? (
                <div className="space-y-3">
                  {[{ key: 'mobile', icon: Smartphone, label: 'Mobile' }, { key: 'desktop', icon: Monitor, label: 'Desktop' }, { key: 'tablet', icon: Tablet, label: 'Tablet' }].map(({ key, icon: Icon, label }) => {
                    const count = d.devices[key] ?? 0;
                    const pct = totalDevices ? Math.round((count / totalDevices) * 100) : 0;
                    return (
                      <div key={key} className="flex items-center gap-3">
                        <Icon size={14} className="text-gray-400 shrink-0" />
                        <span className="w-16 text-xs text-gray-600">{label}</span>
                        <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                          <div className="h-full rounded-full bg-gray-800" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs font-semibold text-gray-700 w-10 text-right">{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              ) : <EmptyState message="No data yet" />}
            </div>
          </div>

          {/* ── Inquiry day-of-week chart ─────────────────────────────────── */}
          <div className="rounded-2xl border border-gray-200 bg-white p-6">
            <SectionTitle>Inquiries by day of week</SectionTitle>
            <p className="text-xs text-gray-400 mt-0.5 mb-5">When people are most likely to send you an inquiry</p>
            {d.inquiry_dow.some(v => v > 0) ? (
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={d.inquiry_dow.map((count, i) => ({ day: DOW_LABELS[i], count }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={24} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="count" name="Inquiries" radius={[6, 6, 0, 0]}>
                    {d.inquiry_dow.map((_, i) => (
                      <Cell key={i} fill={d.inquiry_dow[i] === Math.max(...d.inquiry_dow) ? CHART_BLUE : '#e5e7eb'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyState message="No inquiry data yet" />}
          </div>

          {/* ── Photo performance grid ────────────────────────────────────── */}
          {d.photo_views.length > 0 && (
            <div className="rounded-2xl border border-gray-200 bg-white p-6">
              <SectionTitle>Photo performance</SectionTitle>
              <p className="text-xs text-gray-400 mt-0.5 mb-5">How many times each gallery photo was viewed</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {d.photo_views.map(({ index, count }) => {
                  const maxCount = d.photo_views[0]?.count ?? 1;
                  const url = photoMap[index];
                  const intensity = Math.round((count / maxCount) * 100);
                  return (
                    <div key={index} className="relative rounded-xl overflow-hidden border border-gray-200 aspect-[4/3] bg-gray-100 group">
                      {url ? (
                        <Image src={url} alt={`Photo ${index + 1}`} fill className="object-cover" unoptimized sizes="200px" />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400">
                          Photo {index + 1}
                        </div>
                      )}
                      {/* Overlay */}
                      <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <p className="text-white text-2xl font-bold">{count}</p>
                        <p className="text-white/80 text-[10px]">views</p>
                      </div>
                      {/* Always-visible badge */}
                      <div className="absolute bottom-2 right-2 rounded-lg px-1.5 py-0.5 text-[10px] font-bold text-white"
                        style={{ background: `rgba(0,0,0,${0.4 + intensity * 0.004})` }}>
                        {count}
                      </div>
                      {/* Top performer badge */}
                      {index === d.photo_views[0]?.index && (
                        <div className="absolute top-2 left-2 rounded-full bg-amber-400 px-2 py-0.5 text-[9px] font-bold text-white">
                          #1
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Geography ────────────────────────────────────────────────── */}
          {(d.top_cities.length > 0 || d.top_countries.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {d.top_cities.length > 0 && (
                <div className="rounded-2xl border border-gray-200 bg-white p-6 space-y-3">
                  <div className="flex items-center gap-2"><MapPin size={13} className="text-gray-400" /><SectionTitle>Top cities</SectionTitle></div>
                  {d.top_cities.map(c => <MiniBarRow key={c.city} label={c.city} value={c.count} max={d.top_cities[0]?.count ?? 1} />)}
                </div>
              )}
              {d.top_countries.length > 0 && (
                <div className="rounded-2xl border border-gray-200 bg-white p-6 space-y-3">
                  <div className="flex items-center gap-2"><ArrowUpRight size={13} className="text-gray-400" /><SectionTitle>Top countries</SectionTitle></div>
                  {d.top_countries.map(c => <MiniBarRow key={c.country} label={c.country} value={c.count} max={d.top_countries[0]?.count ?? 1} />)}
                </div>
              )}
            </div>
          )}

          {/* ── Social clicks ─────────────────────────────────────────────── */}
          {Object.keys(d.social_clicks).length > 0 && (
            <div className="rounded-2xl border border-gray-200 bg-white p-6 space-y-3">
              <SectionTitle>Social link clicks</SectionTitle>
              {Object.entries(d.social_clicks).sort(([,a],[,b])=>b-a).map(([platform, count]) => (
                <MiniBarRow key={platform} label={platform} value={count} max={Math.max(...Object.values(d.social_clicks), 1)} />
              ))}
            </div>
          )}
          {/* ── Lead insights (demographics from your own data) ──────── */}
          {insights && insights.total_leads > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 pt-2">
                <UserCheck size={16} className="text-gray-400" />
                <h2 className="text-base font-semibold text-gray-900">Lead insights</h2>
                <span className="text-xs text-gray-400">— from {insights.total_leads} inquiries (all time)</span>
              </div>
              <p className="text-xs text-gray-500 -mt-2">
                Demographic-style breakdowns built from your actual inquiry data — no third-party tracking needed.
              </p>

              {/* Summary KPIs */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <KpiCard icon={Users} label="Avg guest count" value={insights.avg_guest_count ?? '—'} sub="Per inquiry" color="blue" />
                <KpiCard icon={DollarSign} label="Avg deal value" value={fmtCents(insights.avg_opportunity_value)} sub="When set" color="green" />
                <KpiCard icon={Users} label="Total leads" value={insights.total_leads.toLocaleString()} sub="All time" color="purple" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Guest count distribution */}
                {insights.guest_buckets.length > 0 && (
                  <div className="rounded-2xl border border-gray-200 bg-white p-6 space-y-3">
                    <div className="flex items-center gap-2"><Users size={13} className="text-gray-400" /><SectionTitle>Guest count breakdown</SectionTitle></div>
                    {insights.guest_buckets.map(b => (
                      <MiniBarRow key={b.label} label={b.label} value={b.count} max={Math.max(...insights.guest_buckets.map(x=>x.count), 1)} />
                    ))}
                  </div>
                )}

                {/* Lead sources */}
                {insights.sources.length > 0 && (
                  <div className="rounded-2xl border border-gray-200 bg-white p-6 space-y-3">
                    <div className="flex items-center gap-2"><ArrowUpRight size={13} className="text-gray-400" /><SectionTitle>How leads found you</SectionTitle></div>
                    {insights.sources.map(s => (
                      <MiniBarRow key={s.source} label={s.source} value={s.count} max={insights.sources[0]?.count ?? 1} />
                    ))}
                  </div>
                )}
              </div>

              {/* Event month distribution */}
              {insights.event_months.some(m => m.count > 0) && (
                <div className="rounded-2xl border border-gray-200 bg-white p-6">
                  <div className="flex items-center gap-2 mb-1"><CalendarDays size={13} className="text-gray-400" /><SectionTitle>Wedding month popularity</SectionTitle></div>
                  <p className="text-xs text-gray-400 mb-5">Which months your leads are planning their events</p>
                  <ResponsiveContainer width="100%" height={140}>
                    <BarChart data={insights.event_months} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="count" name="Leads" radius={[4,4,0,0]}>
                        {insights.event_months.map((m, i) => (
                          <Cell key={i} fill={m.count === Math.max(...insights.event_months.map(x=>x.count)) ? CHART_BLUE : '#e5e7eb'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Opportunity value ranges */}
                {insights.value_buckets.length > 0 && (
                  <div className="rounded-2xl border border-gray-200 bg-white p-6 space-y-3">
                    <div className="flex items-center gap-2"><DollarSign size={13} className="text-gray-400" /><SectionTitle>Deal value ranges</SectionTitle></div>
                    {insights.value_buckets.map(b => (
                      <MiniBarRow key={b.label} label={b.label} value={b.count} max={Math.max(...insights.value_buckets.map(x=>x.count),1)} />
                    ))}
                  </div>
                )}

                {/* Booking timelines */}
                {insights.timelines.length > 0 && (
                  <div className="rounded-2xl border border-gray-200 bg-white p-6 space-y-3">
                    <div className="flex items-center gap-2"><Clock size={13} className="text-gray-400" /><SectionTitle>Booking timeline</SectionTitle></div>
                    {insights.timelines.filter(t=>t.label !== 'Unknown').map(t => (
                      <MiniBarRow key={t.label} label={t.label} value={t.count} max={Math.max(...insights.timelines.map(x=>x.count),1)} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      <div className="pb-4">
        <p className="text-xs text-gray-400 text-center">
          Delta % compares current period to the previous equal-length period. All times are UTC.
          <span className="mx-2">·</span>
          <Radio size={10} className="inline" /> Live panel refreshes every 30 seconds.
        </p>
      </div>
    </div>
  );
}
