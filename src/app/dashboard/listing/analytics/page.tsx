'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  ExternalLink,
  Loader2,
  LineChart,
  Save,
  CheckCircle2,
  AlertCircle,
  Users,
  MousePointerClick,
  Sparkles,
} from 'lucide-react';
import {
  LineChart as ReLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

const CARD = 'rounded-3xl border border-gray-200 bg-white p-6 sm:p-8';
const INPUT =
  'w-full rounded-2xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:bg-white transition-colors';
const LABEL = 'block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide';

type AnalyticsPayload = {
  ga4_measurement_id: string | null;
  ga4_property_id: string | null;
  listing_slug: string | null;
  venue_name: string | null;
  ga4_reports_available?: boolean;
};

type ReportOk = {
  ok: true;
  days: number;
  totals: {
    sessions: number;
    activeUsers: number;
    newUsers: number;
    eventCount: number;
  };
  daily: { date: string; sessions: number; activeUsers: number }[];
};

type ReportErr = {
  ok: false;
  code: string;
  message: string;
};

type ReportResponse = ReportOk | ReportErr;

function formatGaDate(ymd: string): string {
  if (ymd.length !== 8) return ymd;
  const y = ymd.slice(0, 4);
  const m = ymd.slice(4, 6);
  const d = ymd.slice(6, 8);
  const dt = new Date(`${y}-${m}-${d}T12:00:00`);
  if (Number.isNaN(dt.getTime())) return ymd;
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function ListingAnalyticsPage() {
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [ga4Input, setGa4Input] = useState('');
  const [propertyIdInput, setPropertyIdInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedOk, setSavedOk] = useState(false);

  const [reportLoading, setReportLoading] = useState(false);
  const [report, setReport] = useState<ReportResponse | null>(null);

  const saEmail =
    typeof process.env.NEXT_PUBLIC_GA_ANALYTICS_SA_EMAIL === 'string'
      ? process.env.NEXT_PUBLIC_GA_ANALYTICS_SA_EMAIL.trim()
      : '';

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await fetch('/api/listing/analytics', { cache: 'no-store' });
    if (!res.ok) {
      setError('Could not load analytics settings.');
      setLoading(false);
      return;
    }
    const j = (await res.json()) as AnalyticsPayload;
    setData(j);
    setGa4Input(j.ga4_measurement_id ?? '');
    setPropertyIdInput(j.ga4_property_id ?? '');
    setLoading(false);
  }, []);

  const loadReport = useCallback(async () => {
    setReportLoading(true);
    try {
      const res = await fetch('/api/listing/analytics/report?days=28', { cache: 'no-store' });
      const j = (await res.json()) as ReportResponse;
      setReport(j);
    } catch {
      setReport({ ok: false, code: 'network', message: 'Could not load report.' });
    } finally {
      setReportLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (loading) return;
    if (!data?.ga4_property_id?.trim()) {
      setReport(null);
      return;
    }
    void loadReport();
  }, [loading, data?.ga4_property_id, loadReport]);

  async function save() {
    setSaving(true);
    setError('');
    setSavedOk(false);
    const res = await fetch('/api/listing/analytics', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ga4_measurement_id: ga4Input.trim() || null,
        ga4_property_id: propertyIdInput.trim() || null,
      }),
    });
    const j = (await res.json().catch(() => ({}))) as AnalyticsPayload & { error?: string };
    setSaving(false);
    if (!res.ok) {
      setError(j.error || 'Save failed');
      return;
    }
    setData({
      ga4_measurement_id: j.ga4_measurement_id ?? null,
      ga4_property_id: j.ga4_property_id ?? null,
      listing_slug: j.listing_slug ?? null,
      venue_name: j.venue_name ?? null,
      ga4_reports_available: j.ga4_reports_available,
    });
    setGa4Input(j.ga4_measurement_id ?? '');
    setPropertyIdInput(j.ga4_property_id ?? '');
    setSavedOk(true);
    setTimeout(() => setSavedOk(false), 2500);
    void loadReport();
  }

  const directoryBase =
    (process.env.NEXT_PUBLIC_DIRECTORY_URL || 'https://storyvenue.com').replace(/\/$/, '');
  const listingUrl =
    data?.listing_slug ? `${directoryBase}/venue/${data.listing_slug}` : null;

  const chartData =
    report && report.ok
      ? report.daily.map((row) => ({
          label: formatGaDate(row.date),
          sessions: row.sessions,
          users: row.activeUsers,
        }))
      : [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <p className="text-sm font-medium text-gray-500">
          <Link href="/dashboard/listing" className="hover:text-gray-800">
            Venue listing
          </Link>
          <span className="mx-2 text-gray-300">/</span>
          <span className="text-gray-900">Analytics</span>
        </p>
        <h1 className="mt-2 font-heading text-2xl sm:text-3xl text-gray-900 flex items-center gap-2">
          <BarChart3 className="w-7 h-7 text-gray-700 shrink-0" />
          Google Analytics
        </h1>
        <p className="mt-2 text-sm text-gray-600 max-w-xl">
          Connect GA4 so we can load your tracking tag on your public StoryVenue listing and, when you add your
          Property ID, show traffic summaries here — no need to open Google Analytics for a quick check.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      ) : (
        <div className="space-y-6">
          <section className={CARD}>
            <h2 className="font-heading text-lg text-gray-900 mb-1 flex items-center gap-2">
              <LineChart className="w-5 h-5 text-gray-600" />
              GA4 connection
            </h2>
            <p className="text-sm text-gray-500 mb-5">
              <strong className="text-gray-800">Measurement ID (G-…)</strong> — In{' '}
              <a
                href="https://analytics.google.com/"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-pink-700 hover:text-pink-900 inline-flex items-center gap-0.5"
              >
                Google Analytics
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              , open <strong className="text-gray-800">Admin</strong> → <strong className="text-gray-800">Data streams</strong> →
              your web stream → copy the <strong className="text-gray-800">Measurement ID</strong>. We inject the gtag
              script on your published listing page.
            </p>

            <label className={LABEL} htmlFor="ga4">
              Measurement ID
            </label>
            <input
              id="ga4"
              type="text"
              className={INPUT}
              placeholder="G-XXXXXXXXXX"
              value={ga4Input}
              onChange={(e) => setGa4Input(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />

            <div className="mt-6 border-t border-gray-100 pt-5">
              <p className="text-sm text-gray-500 mb-3">
                <strong className="text-gray-800">Property ID (digits)</strong> — For charts on this page. In GA4,
                go to <strong className="text-gray-800">Admin</strong> → <strong className="text-gray-800">Property settings</strong> and
                copy the <strong className="text-gray-800">Property ID</strong> (numbers only). Our server uses Google&apos;s Data API;
                you must grant the StoryVenue service account access (see below).
              </p>
              <label className={LABEL} htmlFor="ga4prop">
                Property ID (optional, for in-app reports)
              </label>
              <input
                id="ga4prop"
                type="text"
                inputMode="numeric"
                className={INPUT}
                placeholder="e.g. 123456789"
                value={propertyIdInput}
                onChange={(e) => setPropertyIdInput(e.target.value.replace(/\D/g, ''))}
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            {data?.ga4_reports_available === false && (
              <p className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                In-dashboard reports require the StoryVenue app to be configured with a Google service account. Your
                Measurement ID still works for tracking on the listing page.
              </p>
            )}

            {saEmail && (
              <p className="mt-3 text-xs text-gray-600">
                Add this email as <strong className="text-gray-800">Viewer</strong> on your GA4 property:{' '}
                <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{saEmail}</code>
              </p>
            )}

            {error && (
              <p className="mt-2 flex items-start gap-2 text-sm text-red-600">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                {error}
              </p>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#1b1b1b] px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save
              </button>
              {savedOk && (
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700">
                  <CheckCircle2 className="w-4 h-4" /> Saved
                </span>
              )}
            </div>
          </section>

          <section className={CARD}>
            <h2 className="font-heading text-lg text-gray-900 mb-1 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-pink-600" />
              Listing traffic (last 28 days)
            </h2>
            <p className="text-sm text-gray-500 mb-5">
              Metrics are scoped to page paths containing your public listing URL when your venue has a listing slug.
              If numbers look low, confirm the Measurement ID matches this property and that the service account can
              read the property.
            </p>

            {reportLoading && (
              <div className="flex items-center justify-center py-16 text-gray-400">
                <Loader2 className="w-8 h-8 animate-spin" />
              </div>
            )}

            {!reportLoading && report && !report.ok && (
              <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-4 text-sm text-gray-700">
                <p className="font-medium text-gray-900 mb-1">Reports unavailable</p>
                <p>{report.message}</p>
              </div>
            )}

            {!reportLoading && report && report.ok && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                  <div className="rounded-2xl border border-gray-100 bg-gray-50/80 p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 flex items-center gap-1">
                      <MousePointerClick className="w-3.5 h-3.5" /> Sessions
                    </p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{report.totals.sessions.toLocaleString()}</p>
                  </div>
                  <div className="rounded-2xl border border-gray-100 bg-gray-50/80 p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 flex items-center gap-1">
                      <Users className="w-3.5 h-3.5" /> Active users
                    </p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{report.totals.activeUsers.toLocaleString()}</p>
                  </div>
                  <div className="rounded-2xl border border-gray-100 bg-gray-50/80 p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">New users</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{report.totals.newUsers.toLocaleString()}</p>
                  </div>
                  <div className="rounded-2xl border border-gray-100 bg-gray-50/80 p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Events</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{report.totals.eventCount.toLocaleString()}</p>
                  </div>
                </div>

                {chartData.length > 0 ? (
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <ReLineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-gray-100" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} className="text-gray-400" />
                        <YAxis tick={{ fontSize: 11 }} className="text-gray-400" width={40} />
                        <Tooltip
                          contentStyle={{ borderRadius: '12px', border: '1px solid #e5e7eb', fontSize: '12px' }}
                        />
                        <Line type="monotone" dataKey="sessions" name="Sessions" stroke="#1b1b1b" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="users" name="Active users" stroke="#db2777" strokeWidth={2} dot={false} />
                      </ReLineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 text-center py-8">No daily rows returned for this period.</p>
                )}
              </>
            )}

            {!reportLoading && !report && data?.ga4_property_id && (
              <p className="text-sm text-gray-500">Save your Property ID and ensure the server can access GA4 to load charts.</p>
            )}

            {!data?.ga4_property_id && (
              <p className="text-sm text-gray-500">
                Add a Property ID above to see sessions and users here after you grant API access.
              </p>
            )}
          </section>

          <section className={CARD}>
            <h2 className="font-heading text-lg text-gray-900 mb-3">More in Google Analytics</h2>
            <p className="text-sm text-gray-600 mb-4">
              Use Google&apos;s full interface for explorations, conversions, and audiences. Quick summaries stay on this
              page when Property ID and server access are set up.
            </p>
            <div className="flex flex-wrap gap-2">
              <a
                href="https://analytics.google.com/analytics/web/#/realtime/overview"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
              >
                Open Realtime
                <ExternalLink className="w-3.5 h-3.5 text-gray-500" />
              </a>
              <a
                href="https://analytics.google.com/analytics/web/"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
              >
                Open Analytics home
                <ExternalLink className="w-3.5 h-3.5 text-gray-500" />
              </a>
              {listingUrl && (
                <a
                  href={listingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-pink-200 bg-pink-50 px-4 py-2 text-sm font-medium text-pink-900 hover:bg-pink-100"
                >
                  Open public listing
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-gray-100 bg-gray-50/80 p-6 sm:p-8">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">How it works</h3>
            <ul className="text-sm text-gray-600 space-y-2 list-disc pl-5">
              <li>
                The <strong className="text-gray-800">Measurement ID</strong> powers the gtag snippet on your{' '}
                <strong className="text-gray-800">published</strong> StoryVenue listing page.
              </li>
              <li>
                The <strong className="text-gray-800">Property ID</strong> lets StoryVenue query Google&apos;s Analytics Data API
                so we can show the summary and chart above (server-side, using a Google service account).
              </li>
              <li>It can take a few hours for new traffic to appear in reports.</li>
              <li>Clear the fields and save to stop tracking or in-app reports for that ID.</li>
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
