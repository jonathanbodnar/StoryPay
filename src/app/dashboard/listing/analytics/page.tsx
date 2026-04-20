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
} from 'lucide-react';

const CARD = 'rounded-3xl border border-gray-200 bg-white p-6 sm:p-8';
const INPUT =
  'w-full rounded-2xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:bg-white transition-colors';
const LABEL = 'block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide';

type AnalyticsPayload = {
  ga4_measurement_id: string | null;
  listing_slug: string | null;
  venue_name: string | null;
};

export default function ListingAnalyticsPage() {
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [ga4Input, setGa4Input] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedOk, setSavedOk] = useState(false);

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
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    setError('');
    setSavedOk(false);
    const res = await fetch('/api/listing/analytics', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ga4_measurement_id: ga4Input.trim() || null }),
    });
    const j = (await res.json().catch(() => ({}))) as AnalyticsPayload & { error?: string };
    setSaving(false);
    if (!res.ok) {
      setError(j.error || 'Save failed');
      return;
    }
    setData({
      ga4_measurement_id: j.ga4_measurement_id ?? null,
      listing_slug: j.listing_slug ?? null,
      venue_name: j.venue_name ?? null,
    });
    setGa4Input(j.ga4_measurement_id ?? '');
    setSavedOk(true);
    setTimeout(() => setSavedOk(false), 2500);
  }

  const directoryBase =
    (process.env.NEXT_PUBLIC_DIRECTORY_URL || 'https://storyvenue.com').replace(/\/$/, '');
  const listingUrl =
    data?.listing_slug ? `${directoryBase}/venue/${data.listing_slug}` : null;

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
          Connect your GA4 property to measure traffic on your public StoryVenue listing page. Reports and
          exploration stay in Google Analytics — we save your Measurement ID and load the tracking tag on your
          listing when it is published.
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
              GA4 Measurement ID
            </h2>
            <p className="text-sm text-gray-500 mb-5">
              In{' '}
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
              your web stream → copy the <strong className="text-gray-800">Measurement ID</strong> (starts with{' '}
              <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">G-</code>).
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
            <h2 className="font-heading text-lg text-gray-900 mb-3">View reports in Google</h2>
            <p className="text-sm text-gray-600 mb-4">
              StoryVenue does not mirror GA dashboards here. Use Google Analytics for realtime traffic, acquisition,
              and engagement on your listing URL.
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
                After you save a valid Measurement ID, the gtag snippet for that ID is included on your{' '}
                <strong className="text-gray-800">published</strong> StoryVenue listing page (this app’s public venue
                URL).
              </li>
              <li>It can take a few minutes for new data to appear under Reports or Realtime in GA4.</li>
              <li>Clear the field and save to stop sending listing traffic to that property.</li>
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
