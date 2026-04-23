'use client';

import { useEffect, useState } from 'react';
import {
  Eye, Users, MousePointerClick, TrendingUp,
  BarChart2, Smartphone, Monitor, Tablet,
  MapPin, ArrowUpRight, RefreshCw, CheckCircle,
  AlertCircle,
} from 'lucide-react';

type AnalyticsPayload = {
  days: number;
  total_views: number;
  unique_sessions: number;
  total_interactions: number;
  conversion_rate: number;
  contact_form_opens: number;
  contact_form_submits: number;
  daily: { date: string; views: number; unique_sessions: number }[];
  event_counts: Record<string, number>;
  scroll_depth: { pct_25: number; pct_50: number; pct_75: number; pct_100: number };
  devices: Record<string, number>;
  referrers: { source: string; count: number }[];
  top_countries: { country: string; count: number }[];
  top_cities: { city: string; count: number }[];
  inquiry_dow: number[];
  photo_views: { index: number; count: number }[];
  social_clicks: Record<string, number>;
  _migration_pending?: boolean;
};

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_OPTIONS = [7, 14, 30, 60, 90];

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color = 'gray',
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  color?: 'gray' | 'blue' | 'green' | 'purple' | 'amber';
}) {
  const colors = {
    gray:   'bg-white border-gray-200 text-gray-700',
    blue:   'bg-blue-50 border-blue-100 text-blue-700',
    green:  'bg-emerald-50 border-emerald-100 text-emerald-700',
    purple: 'bg-purple-50 border-purple-100 text-purple-700',
    amber:  'bg-amber-50 border-amber-100 text-amber-700',
  };
  const iconColors = {
    gray: 'text-gray-400', blue: 'text-blue-500', green: 'text-emerald-500',
    purple: 'text-purple-500', amber: 'text-amber-500',
  };
  return (
    <div className={`rounded-2xl border p-5 ${colors[color]}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider opacity-60">{label}</p>
          <p className="mt-1.5 text-3xl font-bold text-gray-900">{value}</p>
          {sub && <p className="mt-1 text-xs opacity-70">{sub}</p>}
        </div>
        <Icon size={20} className={`mt-0.5 ${iconColors[color]}`} />
      </div>
    </div>
  );
}

function MiniBarChart({ data, maxVal }: { data: { label: string; value: number }[]; maxVal: number }) {
  if (!data.length) return <p className="text-xs text-gray-400 py-4 text-center">No data yet</p>;
  return (
    <div className="space-y-1.5">
      {data.map(({ label, value }) => (
        <div key={label} className="flex items-center gap-3">
          <span className="w-24 shrink-0 text-xs text-gray-600 truncate">{label}</span>
          <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-gray-800 transition-all"
              style={{ width: maxVal ? `${(value / maxVal) * 100}%` : '0%' }}
            />
          </div>
          <span className="w-8 text-right text-xs font-semibold text-gray-700">{value}</span>
        </div>
      ))}
    </div>
  );
}

function ViewsSparkline({ daily }: { daily: AnalyticsPayload['daily'] }) {
  if (!daily.length) {
    return (
      <div className="flex items-center justify-center h-24 text-xs text-gray-400">
        No view data yet — data will appear once your listing receives visitors.
      </div>
    );
  }
  const maxViews = Math.max(...daily.map(d => d.views), 1);
  return (
    <div className="flex items-end gap-[3px] h-24 w-full">
      {daily.map(d => (
        <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group relative">
          <div
            className="w-full rounded-t bg-gray-800 hover:bg-blue-600 transition-colors cursor-default"
            style={{ height: `${Math.max(4, (d.views / maxViews) * 88)}px` }}
          />
          <div className="absolute bottom-full mb-1 hidden group-hover:block bg-gray-900 text-white text-[10px] rounded px-1.5 py-1 whitespace-nowrap z-10">
            {d.date}: {d.views} view{d.views !== 1 ? 's' : ''}
          </div>
        </div>
      ))}
    </div>
  );
}

function ScrollDepthBar({ label, pct }: { label: string; pct: number }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-gray-600">{label}</span>
        <span className="font-semibold text-gray-800">{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-700 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function ListingAnalyticsPage() {
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [error, setError] = useState('');

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

  useEffect(() => { void load(days); }, [days]);

  const totalDevices = data ? Object.values(data.devices).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Listing Analytics</h1>
          <p className="mt-0.5 text-sm text-gray-500">How visitors find and engage with your listing</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl border border-gray-200 bg-white overflow-hidden">
            {DAYS_OPTIONS.map(d => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  days === d ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
          <button
            onClick={() => void load(days)}
            disabled={loading}
            className="p-2 rounded-xl border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 disabled:opacity-40 transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={15} /> {error}
        </div>
      )}

      {data?._migration_pending && (
        <div className="flex items-center gap-3 rounded-2xl bg-amber-50 border border-amber-100 px-5 py-4">
          <AlertCircle size={18} className="text-amber-500 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-900">Database migration pending</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Run migration <code className="font-mono">056_listing_analytics.sql</code> in your Supabase SQL editor
              to start collecting data. Tracking is already active on your listing page.
            </p>
          </div>
        </div>
      )}

      {!data?._migration_pending && !loading && data && (
        <div className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-2.5 text-sm text-emerald-700">
          <CheckCircle size={14} /> Tracking active — collecting data from your public listing
        </div>
      )}

      {/* KPI cards */}
      {data && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={Eye} label="Total views" value={data.total_views.toLocaleString()} sub={`Last ${days} days`} color="blue" />
          <StatCard icon={Users} label="Unique visitors" value={data.unique_sessions.toLocaleString()} color="purple" />
          <StatCard icon={MousePointerClick} label="Form inquiries" value={data.contact_form_submits.toLocaleString()} sub={`${data.contact_form_opens} form opens`} color="green" />
          <StatCard icon={TrendingUp} label="Conversion rate" value={`${data.conversion_rate}%`} sub="Views → inquiries" color="amber" />
        </div>
      )}

      {loading && !data && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-2xl border border-gray-200 bg-white p-5 h-28 animate-pulse">
              <div className="h-3 w-20 bg-gray-100 rounded mb-3" />
              <div className="h-8 w-16 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
      )}

      {/* Views chart */}
      {data && (
        <div className="rounded-2xl border border-gray-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Daily views — last {days} days</h2>
          <ViewsSparkline daily={data.daily} />
        </div>
      )}

      {/* Scroll depth + engagement */}
      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 space-y-3">
            <h2 className="text-sm font-semibold text-gray-900">Scroll depth</h2>
            <p className="text-xs text-gray-400">% of visitors who scroll this far down your listing</p>
            <ScrollDepthBar label="25% of page" pct={data.scroll_depth.pct_25} />
            <ScrollDepthBar label="50% of page" pct={data.scroll_depth.pct_50} />
            <ScrollDepthBar label="75% of page" pct={data.scroll_depth.pct_75} />
            <ScrollDepthBar label="Bottom of page" pct={data.scroll_depth.pct_100} />
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-6 space-y-3">
            <h2 className="text-sm font-semibold text-gray-900">Engagement breakdown</h2>
            <MiniBarChart
              data={[
                { label: 'Photo views', value: data.event_counts['photo_view'] ?? 0 },
                { label: 'FAQ opens', value: data.event_counts['faq_open'] ?? 0 },
                { label: 'Map clicks', value: data.event_counts['map_click'] ?? 0 },
                { label: 'Social clicks', value: data.event_counts['social_click'] ?? 0 },
                { label: 'Form opens', value: data.event_counts['contact_form_open'] ?? 0 },
                { label: 'Form submits', value: data.event_counts['contact_form_submit'] ?? 0 },
              ]}
              maxVal={Math.max(
                data.event_counts['photo_view'] ?? 0,
                data.event_counts['faq_open'] ?? 0,
                data.event_counts['map_click'] ?? 0,
                data.event_counts['social_click'] ?? 0,
                data.event_counts['contact_form_open'] ?? 0,
                data.event_counts['contact_form_submit'] ?? 0,
                1,
              )}
            />
          </div>
        </div>
      )}

      {/* Traffic sources + devices */}
      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 space-y-3">
            <h2 className="text-sm font-semibold text-gray-900">Traffic sources</h2>
            <MiniBarChart
              data={data.referrers.map(r => ({ label: r.source, value: r.count }))}
              maxVal={data.referrers[0]?.count ?? 1}
            />
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-6 space-y-4">
            <h2 className="text-sm font-semibold text-gray-900">Devices</h2>
            {totalDevices > 0 ? (
              <div className="space-y-3">
                {[
                  { key: 'mobile', icon: Smartphone, label: 'Mobile' },
                  { key: 'desktop', icon: Monitor, label: 'Desktop' },
                  { key: 'tablet', icon: Tablet, label: 'Tablet' },
                ].map(({ key, icon: Icon, label }) => {
                  const count = data.devices[key] ?? 0;
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
            ) : (
              <p className="text-xs text-gray-400 py-4 text-center">No data yet</p>
            )}
          </div>
        </div>
      )}

      {/* Inquiry day-of-week heatmap */}
      {data && (
        <div className="rounded-2xl border border-gray-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Inquiries by day of week</h2>
          {data.inquiry_dow.some(v => v > 0) ? (
            <div className="flex gap-2 items-end">
              {data.inquiry_dow.map((count, i) => {
                const maxDow = Math.max(...data.inquiry_dow, 1);
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-2">
                    <div
                      className="w-full rounded-lg bg-gray-900 transition-all"
                      style={{ height: `${Math.max(8, (count / maxDow) * 80)}px` }}
                    />
                    <span className="text-[10px] text-gray-500">{DOW_LABELS[i]}</span>
                    <span className="text-xs font-semibold text-gray-800">{count}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-gray-400 text-center py-4">No inquiry data yet</p>
          )}
        </div>
      )}

      {/* Top cities + countries */}
      {data && (data.top_cities.length > 0 || data.top_countries.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.top_cities.length > 0 && (
            <div className="rounded-2xl border border-gray-200 bg-white p-6 space-y-3">
              <div className="flex items-center gap-2">
                <MapPin size={14} className="text-gray-400" />
                <h2 className="text-sm font-semibold text-gray-900">Top cities</h2>
              </div>
              <MiniBarChart
                data={data.top_cities.map(c => ({ label: c.city, value: c.count }))}
                maxVal={data.top_cities[0]?.count ?? 1}
              />
            </div>
          )}
          {data.top_countries.length > 0 && (
            <div className="rounded-2xl border border-gray-200 bg-white p-6 space-y-3">
              <div className="flex items-center gap-2">
                <ArrowUpRight size={14} className="text-gray-400" />
                <h2 className="text-sm font-semibold text-gray-900">Top countries</h2>
              </div>
              <MiniBarChart
                data={data.top_countries.map(c => ({ label: c.country, value: c.count }))}
                maxVal={data.top_countries[0]?.count ?? 1}
              />
            </div>
          )}
        </div>
      )}

      {/* Social clicks */}
      {data && Object.keys(data.social_clicks).length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 space-y-3">
          <h2 className="text-sm font-semibold text-gray-900">Social link clicks</h2>
          <MiniBarChart
            data={Object.entries(data.social_clicks)
              .sort(([, a], [, b]) => b - a)
              .map(([platform, count]) => ({ label: platform, value: count }))}
            maxVal={Math.max(...Object.values(data.social_clicks), 1)}
          />
        </div>
      )}

      {/* Photo views */}
      {data && data.photo_views.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 space-y-3">
          <h2 className="text-sm font-semibold text-gray-900">Photo views by position</h2>
          <MiniBarChart
            data={data.photo_views.map(p => ({ label: `Photo ${p.index + 1}`, value: p.count }))}
            maxVal={data.photo_views[0]?.count ?? 1}
          />
        </div>
      )}

      <div className="pb-8">
        <p className="text-xs text-gray-400 text-center">
          <BarChart2 size={12} className="inline mr-1" />
          Phase 2 will add real-time sparklines, listing health score, competitive benchmarks, and weekly email digests.
        </p>
      </div>
    </div>
  );
}
