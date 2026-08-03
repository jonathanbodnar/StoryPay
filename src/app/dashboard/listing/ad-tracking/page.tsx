'use client';

import { useEffect, useState } from 'react';
import { Target, Check, Loader2, ExternalLink, Copy, Link2 } from 'lucide-react';

const DIRECTORY_URL = process.env.NEXT_PUBLIC_DIRECTORY_URL ?? 'https://storyvenue.com';

interface VenueInfo {
  slug: string | null;
  meta_pixel_id: string | null;
  meta_capi_access_token: string | null; // masked '••••XXXX' or null on GET
}

export default function AdTrackingPage() {
  const [venue, setVenue] = useState<VenueInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const [pixelIdInput, setPixelIdInput] = useState('');
  const [savingPixelId, setSavingPixelId] = useState(false);
  const [pixelIdSaved, setPixelIdSaved] = useState(false);
  const [pixelIdError, setPixelIdError] = useState('');

  const [tokenInput, setTokenInput] = useState('');
  const [savingToken, setSavingToken] = useState(false);
  const [tokenSaved, setTokenSaved] = useState(false);
  const [tokenError, setTokenError] = useState('');

  const [urlCopied, setUrlCopied] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/venues/me', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          setVenue(data);
          if (data.meta_pixel_id) setPixelIdInput(data.meta_pixel_id);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function savePixelId() {
    const val = pixelIdInput.trim();
    if (!val) return;
    setSavingPixelId(true);
    setPixelIdError('');
    setPixelIdSaved(false);
    try {
      const res = await fetch('/api/venues/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meta_pixel_id: val }),
      });
      if (!res.ok) { setPixelIdError('Failed to save. Please try again.'); return; }
      const updated = await res.json();
      setVenue(prev => prev ? { ...prev, meta_pixel_id: updated.meta_pixel_id } : prev);
      setPixelIdSaved(true);
      setTimeout(() => setPixelIdSaved(false), 3000);
    } catch { setPixelIdError('Failed to save. Please try again.'); }
    finally { setSavingPixelId(false); }
  }

  async function saveToken() {
    const val = tokenInput.trim();
    if (!val) return;
    setSavingToken(true);
    setTokenError('');
    setTokenSaved(false);
    try {
      const res = await fetch('/api/venues/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meta_capi_access_token: val }),
      });
      if (!res.ok) { setTokenError('Failed to save. Please try again.'); return; }
      setVenue(prev => prev ? { ...prev, meta_capi_access_token: `••••${val.slice(-4)}` } : prev);
      setTokenSaved(true);
      setTokenInput('');
      setTimeout(() => setTokenSaved(false), 3000);
    } catch { setTokenError('Failed to save. Please try again.'); }
    finally { setSavingToken(false); }
  }

  const thankYouUrl = venue?.slug ? `${DIRECTORY_URL}/venue/${venue.slug}/thankyou` : '';

  async function copyThankYouUrl() {
    if (!thankYouUrl) return;
    try {
      await navigator.clipboard.writeText(thankYouUrl);
      setUrlCopied(true);
      setTimeout(() => setUrlCopied(false), 3000);
    } catch { /* clipboard permission denied — user can still select/copy manually */ }
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-0 flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-gray-300" />
      </div>
    );
  }

  if (!venue) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-0 flex min-h-[400px] items-center justify-center text-sm text-gray-500">
        Unable to load settings.
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-0">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-600">
            <Target size={16} className="text-white" />
          </div>
          <h1 className="text-[22px] font-bold text-gray-900 tracking-tight">Ad Tracking</h1>
        </div>
        <p className="text-[13px] text-gray-500 ml-10">
          Turn every pricing guide download into a Meta conversion event, so your ad campaigns can optimize toward real leads.
        </p>
      </div>

      <div className="space-y-4">
        <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
          <div className="px-6 py-5 space-y-5">
            <p className="text-sm text-gray-500">
              Connect your Meta Pixel and Conversions API access token to send guide-download leads
              from your listing page to Meta as a <span className="font-mono text-xs">Lead</span> event.
              This is entirely server-side — no tracking script is ever added to your listing page, and
              nothing else about your existing guide delivery changes.
            </p>
            <p className="text-sm text-gray-500">
              Find both values in{' '}
              <a
                href="https://business.facebook.com/events_manager2"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-violet-600 hover:text-violet-700 underline underline-offset-2"
              >
                Meta Events Manager <ExternalLink size={11} />
              </a>{' '}
              → select your pixel → <strong>Settings → Conversions API</strong>. The Pixel ID is shown at the
              top of the Overview tab; the access token is generated further down the Settings page under
              &ldquo;Conversions API&rdquo;.
            </p>

            {/* Pixel ID */}
            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
              <p className="text-xs font-medium text-gray-700 mb-2">Meta Pixel ID</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={pixelIdInput}
                  onChange={e => setPixelIdInput(e.target.value)}
                  placeholder="e.g. 123456789012345"
                  className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none font-mono"
                />
                <button
                  onClick={() => void savePixelId()}
                  disabled={savingPixelId || !pixelIdInput.trim()}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-gray-900 px-4 py-2 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-50 transition-colors"
                >
                  {savingPixelId ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  {savingPixelId ? 'Saving…' : 'Save'}
                </button>
              </div>
              {pixelIdSaved && <p className="mt-2 text-xs text-emerald-600">Saved successfully.</p>}
              {pixelIdError && <p className="mt-2 text-xs text-red-600">{pixelIdError}</p>}
            </div>

            {/* Conversions API Access Token */}
            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
              <p className="text-xs font-medium text-gray-700 mb-2">Conversions API Access Token</p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={tokenInput}
                  onChange={e => setTokenInput(e.target.value)}
                  placeholder={venue.meta_capi_access_token ? `${venue.meta_capi_access_token} (paste a new one to replace)` : 'Paste your Conversions API access token here'}
                  className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none font-mono"
                />
                <button
                  onClick={() => void saveToken()}
                  disabled={savingToken || !tokenInput.trim()}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-gray-900 px-4 py-2 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-50 transition-colors"
                >
                  {savingToken ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  {savingToken ? 'Saving…' : 'Save'}
                </button>
              </div>
              {tokenSaved && <p className="mt-2 text-xs text-emerald-600">Saved successfully.</p>}
              {tokenError && <p className="mt-2 text-xs text-red-600">{tokenError}</p>}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
          <div className="px-6 py-5 space-y-4">
            <div className="flex items-center gap-2">
              <Link2 size={15} className="text-violet-600" />
              <h2 className="text-sm font-semibold text-gray-900">Custom Conversion URL</h2>
            </div>
            <p className="text-sm text-gray-500">
              Every guide download lands on your venue&apos;s thank-you page below. Paste this URL into
              Meta as a <span className="font-mono text-xs">URL</span>-based Custom Conversion so your ad
              campaigns can track and optimize toward real guide downloads &mdash; no extra setup needed
              beyond this one paste.
            </p>

            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
              <p className="text-xs font-medium text-gray-700 mb-2">Your Thank-You Page URL</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={thankYouUrl}
                  onFocus={e => e.currentTarget.select()}
                  className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 font-mono"
                />
                <button
                  onClick={() => void copyThankYouUrl()}
                  disabled={!thankYouUrl}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-gray-900 px-4 py-2 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-50 transition-colors"
                >
                  {urlCopied ? <Check size={13} /> : <Copy size={13} />}
                  {urlCopied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
              <p className="text-xs font-medium text-gray-700 mb-2">How to set it up in Meta (one-time, ~1 min)</p>
              <ol className="list-decimal list-inside space-y-1 text-sm text-gray-500">
                <li>
                  Open{' '}
                  <a
                    href="https://business.facebook.com/events_manager2/custom_conversions"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-violet-600 hover:text-violet-700 underline underline-offset-2"
                  >
                    Meta Events Manager &rarr; Custom Conversions <ExternalLink size={11} />
                  </a>
                </li>
                <li>Click <strong>Create Custom Conversion</strong></li>
                <li>Choose rule type <strong>URL</strong>, then <strong>contains</strong></li>
                <li>Paste the URL above, name it something like &ldquo;Guide Download&rdquo;, and save</li>
                <li>Select it as the conversion event on your ad campaign</li>
              </ol>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
