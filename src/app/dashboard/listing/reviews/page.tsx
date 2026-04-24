'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Calendar,
  ChevronDown,
  Loader2,
  MessageSquareQuote,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  Trash2,
  Eye,
  EyeOff,
  Clock,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import { classNames } from '@/lib/utils';

type ReviewStatus = 'pending' | 'published' | 'hidden';

interface Review {
  id: string;
  venue_id: string;
  rating: number;
  title: string | null;
  body: string;
  reviewer_name: string;
  reviewer_email: string | null;
  wedding_date: string | null;
  status: ReviewStatus;
  source: string;
  created_at: string;
  updated_at: string;
}

const FILTER_TABS: { id: 'all' | ReviewStatus; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'published', label: 'Published' },
  { id: 'pending', label: 'Pending' },
  { id: 'hidden', label: 'Hidden' },
];

function StarsDisplay({ value, size = 'md' }: { value: number; size?: 'sm' | 'md' | 'lg' }) {
  const s = size === 'lg' ? 28 : size === 'md' ? 18 : 14;
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={s}
          className={classNames(
            n <= value ? 'fill-amber-400 text-amber-400' : 'fill-gray-100 text-gray-200',
          )}
          strokeWidth={n <= value ? 0 : 1.25}
        />
      ))}
    </span>
  );
}

function StarPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [hover, setHover] = useState(0);
  const show = hover || value;
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(0)}
          onClick={() => onChange(n)}
          className="rounded-md p-0.5 transition-transform hover:scale-110"
          aria-label={`${n} stars`}
        >
          <Star
            size={32}
            className={classNames(
              n <= show ? 'fill-amber-400 text-amber-400' : 'fill-gray-100 text-gray-300',
            )}
            strokeWidth={n <= show ? 0 : 1.25}
          />
        </button>
      ))}
    </div>
  );
}

export default function ListingReviewsPage() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<(typeof FILTER_TABS)[number]['id']>('all');
  const [showComposer, setShowComposer] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [reviewerName, setReviewerName] = useState('');
  const [reviewerEmail, setReviewerEmail] = useState('');
  const [weddingDate, setWeddingDate] = useState('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [listingSlug, setListingSlug] = useState<string | null>(null);
  const [publicOrigin, setPublicOrigin] = useState('');
  const [sourceTab, setSourceTab] = useState<'storyvenue' | 'google'>('storyvenue');
  const [googlePlaceInput, setGooglePlaceInput] = useState('');
  type GoogleReviewsCacheState = {
    rating: number | null;
    userRatingCount: number;
    reviews: Array<{
      author_name: string;
      rating: number;
      text: string;
      published_at: string | null;
      profile_photo_url: string | null;
    }>;
  };
  const [googleCache, setGoogleCache] = useState<GoogleReviewsCacheState | null>(null);
  const [googleFetchedAt, setGoogleFetchedAt] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleSaveErr, setGoogleSaveErr] = useState('');
  const [googleSaving, setGoogleSaving] = useState(false);

  // ── Google connection state ───────────────────────────────────────────────
  type GoogleCandidate = {
    place_id: string;
    name: string;
    formatted_address: string;
    rating: number | null;
    user_ratings_total: number | null;
  };
  const [searchCandidates, setSearchCandidates] = useState<GoogleCandidate[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchErr, setSearchErr] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchBox, setShowSearchBox] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Maps link paste flow
  const [mapsUrl, setMapsUrl] = useState('');
  const [urlCandidate, setUrlCandidate] = useState<GoogleCandidate | null>(null);
  const [urlLoading, setUrlLoading] = useState(false);
  const [urlErr, setUrlErr] = useState('');
  // Track whether auto-search has already run for the current tab mount
  const autoSearchDoneRef = useRef(false);

  useEffect(() => {
    setPublicOrigin(typeof window !== 'undefined' ? window.location.origin : '');
  }, []);

  useEffect(() => {
    fetch('/api/listing/me')
      .then((r) => r.json())
      .then((d) => {
        if (d.listing?.slug) setListingSlug(String(d.listing.slug));
      })
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/listing/reviews', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Could not load reviews');
        setReviews([]);
        return;
      }
      setReviews(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load reviews');
      setReviews([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadGoogle = useCallback(async (refresh = false) => {
    setGoogleLoading(true);
    setGoogleSaveErr('');
    try {
      const res = await fetch(
        `/api/listing/google-reviews${refresh ? '?refresh=1' : ''}`,
        { cache: 'no-store' },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setGoogleSaveErr(typeof data.error === 'string' ? data.error : 'Could not load Google reviews');
        return;
      }
      setGooglePlaceInput(typeof data.google_place_id === 'string' ? data.google_place_id : '');
      setGoogleFetchedAt(data.google_reviews_fetched_at ?? null);
      const c = data.cache;
      if (c && typeof c === 'object' && Array.isArray((c as { reviews?: unknown }).reviews)) {
        setGoogleCache(c as GoogleReviewsCacheState);
      } else {
        setGoogleCache(null);
      }
    } catch {
      setGoogleSaveErr('Could not load Google reviews');
    } finally {
      setGoogleLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGoogle(false);
  }, [loadGoogle]);

  const filtered = useMemo(() => {
    if (filter === 'all') return reviews;
    return reviews.filter((r) => r.status === filter);
  }, [reviews, filter]);

  const stats = useMemo(() => {
    const pub = reviews.filter((r) => r.status === 'published');
    const n = pub.length;
    if (n === 0) {
      return { avg: 0, n: 0, dist: [0, 0, 0, 0, 0] as number[] };
    }
    const sum = pub.reduce((a, r) => a + r.rating, 0);
    const dist = [0, 0, 0, 0, 0];
    for (const r of pub) {
      dist[r.rating - 1] += 1;
    }
    return { avg: sum / n, n, dist };
  }, [reviews]);

  async function submitReview(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      const res = await fetch('/api/listing/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating,
          title: title.trim() || null,
          body: body.trim(),
          reviewer_name: reviewerName.trim(),
          reviewer_email: reviewerEmail.trim() || null,
          wedding_date: weddingDate.trim() || null,
          status: 'published',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(typeof data.error === 'string' ? data.error : 'Could not save');
        return;
      }
      setShowComposer(false);
      setTitle('');
      setBody('');
      setReviewerName('');
      setReviewerEmail('');
      setWeddingDate('');
      setRating(5);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function patchStatus(id: string, status: ReviewStatus) {
    setOpenMenuId(null);
    const res = await fetch(`/api/listing/reviews/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (res.ok) await load();
  }

  async function removeReview(id: string) {
    if (!confirm('Delete this review permanently?')) return;
    setOpenMenuId(null);
    const res = await fetch(`/api/listing/reviews/${id}`, { method: 'DELETE' });
    if (res.ok) await load();
  }

  async function saveGooglePlace() {
    setGoogleSaving(true);
    setGoogleSaveErr('');
    try {
      const res = await fetch('/api/listing/google-reviews', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ google_place_id: googlePlaceInput.trim() || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setGoogleSaveErr(typeof data.error === 'string' ? data.error : 'Save failed');
        return;
      }
      if (data.cache && typeof data.cache === 'object') {
        setGoogleCache(data.cache as GoogleReviewsCacheState);
      } else {
        setGoogleCache(null);
      }
      setGoogleFetchedAt(data.google_reviews_fetched_at ?? null);
    } finally {
      setGoogleSaving(false);
    }
  }

  // Run a Text Search against the Places API (New) via our proxy endpoint.
  const runSearch = useCallback(async (customQuery?: string) => {
    setSearchLoading(true);
    setSearchErr('');
    setSearchCandidates([]);
    try {
      const res = await fetch('/api/listing/google-reviews/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(customQuery ? { query: customQuery } : {}),
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = typeof data.error === 'string' ? data.error : 'Search failed';
        setSearchErr(msg);
        // Don't show spinner again for a key-not-configured error —
        // nothing will change until an env var is added.
        if (res.status === 503) setShowSearchBox(true);
        return;
      }
      const candidates = Array.isArray(data.candidates) ? (data.candidates as GoogleCandidate[]) : [];
      setSearchCandidates(candidates);
      // Pre-fill the search box with what was actually searched so the owner
      // can see it and tweak it if the results aren't right.
      if (typeof data.query_used === 'string' && !customQuery) {
        setSearchQuery(data.query_used);
      }
      if (candidates.length === 0) {
        setShowSearchBox(true);
        setSearchErr('No matches found — edit the search below and try again.');
      }
    } catch {
      setSearchErr('Search failed — check your connection and try again.');
    } finally {
      setSearchLoading(false);
    }
  }, []);

  // Auto-search when the Google tab is selected and no Place ID is set yet.
  useEffect(() => {
    if (sourceTab !== 'google') return;
    if (autoSearchDoneRef.current) return;
    // If there's already a saved Place ID we don't need to search.
    if (googlePlaceInput.trim()) return;
    autoSearchDoneRef.current = true;
    void runSearch();
  }, [sourceTab, googlePlaceInput, runSearch]);

  // Confirm a candidate — save the Place ID and sync reviews.
  const confirmCandidate = useCallback(async (candidate: GoogleCandidate) => {
    setConfirmingId(candidate.place_id);
    setGoogleSaveErr('');
    try {
      const res = await fetch('/api/listing/google-reviews', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ google_place_id: candidate.place_id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setGoogleSaveErr(typeof data.error === 'string' ? data.error : 'Save failed');
        return;
      }
      setGooglePlaceInput(candidate.place_id);
      setGoogleFetchedAt(data.google_reviews_fetched_at ?? null);
      if (data.cache && typeof data.cache === 'object') {
        setGoogleCache(data.cache as GoogleReviewsCacheState);
      }
      // Clear search state now that we have a confirmed business.
      setSearchCandidates([]);
      setShowSearchBox(false);
    } catch {
      setGoogleSaveErr('Save failed — try again.');
    } finally {
      setConfirmingId(null);
    }
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    void runSearch(searchQuery.trim());
  };

  const resolveUrl = useCallback(async (url: string) => {
    setUrlLoading(true);
    setUrlErr('');
    setUrlCandidate(null);
    try {
      const res = await fetch('/api/listing/google-reviews/resolve-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setUrlErr(typeof data.error === 'string' ? data.error : 'Could not find business from that link');
        return;
      }
      setUrlCandidate(data as GoogleCandidate);
    } catch {
      setUrlErr('Something went wrong — check your connection and try again.');
    } finally {
      setUrlLoading(false);
    }
  }, []);

  const gAvg = googleCache?.rating ?? null;
  const gCnt = googleCache?.userRatingCount ?? 0;

  return (
    <div className="min-h-screen bg-[#fafaf9] pb-16">
      <div className="relative overflow-hidden border-b border-gray-200/80 bg-gradient-to-br from-[#faf8f5] via-white to-[#f3f6fa]">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-amber-100/40 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-16 -left-16 h-56 w-56 rounded-full bg-sky-100/30 blur-3xl"
          aria-hidden
        />

        <div className="relative mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
          <Link
            href="/dashboard/listing"
            className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-900"
          >
            <ArrowLeft size={16} />
            Back to listing dashboard
          </Link>

          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="mb-2 inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-amber-800 ring-1 ring-amber-200/60">
                <Sparkles size={12} className="text-amber-600" />
                StoryVenue reviews
              </p>
              <h1 className="font-heading text-3xl tracking-tight text-gray-900 sm:text-4xl">
                Couples &amp; guests
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-gray-600 sm:text-base">
                Collect polished testimonials for your directory listing. Reviews marked <strong>published</strong> are
                available via the public API and the embed below for storyvenue.com. Later, couples will sign in here to
                leave reviews you own—like Google, but on your platform.
              </p>
            </div>
            {sourceTab === 'storyvenue' && (
              <button
                type="button"
                onClick={() => {
                  setShowComposer(true);
                  setFormError('');
                }}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl bg-[#1b1b1b] px-5 py-3 text-sm font-semibold text-white transition hover:bg-neutral-800"
              >
                <Plus size={18} />
                Add review
              </button>
            )}
          </div>

          <div className="mt-8 border-b border-gray-200">
            <div className="flex gap-0">
              <button
                type="button"
                onClick={() => setSourceTab('storyvenue')}
                className={classNames(
                  'flex min-w-0 flex-1 items-center gap-3 border-b-2 px-3 py-3 text-left sm:gap-4 sm:px-4',
                  sourceTab === 'storyvenue'
                    ? 'border-gray-900 bg-white/60'
                    : 'border-transparent text-gray-500 hover:text-gray-800',
                )}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-900 text-white">
                  <Sparkles size={18} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-gray-900">StoryVenue</span>
                  <span className="block text-xs text-gray-500">
                    {stats.n === 0 ? '—' : stats.avg.toFixed(1)}/5 · {stats.n} reviews
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setSourceTab('google')}
                className={classNames(
                  'flex min-w-0 flex-1 items-center gap-3 border-b-2 px-3 py-3 text-left sm:gap-4 sm:px-4',
                  sourceTab === 'google'
                    ? 'border-gray-900 bg-white/60'
                    : 'border-transparent text-gray-500 hover:text-gray-800',
                )}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-[10px] font-bold text-gray-700">
                  G
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-gray-900">Google</span>
                  <span className="block text-xs text-gray-500">
                    {gAvg != null ? `${gAvg.toFixed(1)}/5` : '—'} · {gCnt} reviews
                  </span>
                </span>
              </button>
            </div>
          </div>

          {sourceTab === 'storyvenue' ? (
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-3xl border border-gray-200/80 bg-white/90 p-6 backdrop-blur-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Average (published)</p>
              <div className="mt-2 flex items-baseline gap-3">
                <span className="font-heading text-4xl text-gray-900">
                  {stats.n === 0 ? '—' : stats.avg.toFixed(1)}
                </span>
                {stats.n > 0 && <StarsDisplay value={Math.round(stats.avg)} size="md" />}
              </div>
              <p className="mt-2 text-sm text-gray-500">{stats.n} published review{stats.n === 1 ? '' : 's'}</p>
            </div>

            <div className="rounded-3xl border border-gray-200/80 bg-white/90 p-6 backdrop-blur sm:col-span-2 lg:col-span-2">
              <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-gray-400">Rating mix</p>
              <div className="space-y-2">
                {[5, 4, 3, 2, 1].map((star) => {
                  const count = stats.dist[star - 1];
                  const pct = stats.n === 0 ? 0 : Math.round((count / stats.n) * 100);
                  return (
                    <div key={star} className="flex items-center gap-3 text-sm">
                      <span className="w-8 text-gray-500">{star}★</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-amber-300 to-amber-500 transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-8 text-right tabular-nums text-gray-400">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          ) : (
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            <div className="rounded-3xl border border-gray-200/80 bg-white/90 p-6 backdrop-blur-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Google average</p>
              <div className="mt-2 flex items-baseline gap-3">
                <span className="font-heading text-4xl text-gray-900">
                  {gAvg == null ? '—' : gAvg.toFixed(1)}
                </span>
                {gAvg != null && <StarsDisplay value={Math.round(gAvg)} size="md" />}
              </div>
              <p className="mt-2 text-sm text-gray-500">{gCnt} ratings (Google)</p>
            </div>
            <div className="rounded-3xl border border-gray-200/80 bg-white/90 p-6 backdrop-blur-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Last synced</p>
              <p className="mt-3 text-sm text-gray-700">
                {googleFetchedAt
                  ? new Date(googleFetchedAt).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })
                  : 'Not synced yet'}
              </p>
              <button
                type="button"
                onClick={() => void loadGoogle(true)}
                disabled={googleLoading || !googlePlaceInput.trim()}
                className="mt-4 inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
              >
                {googleLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Refresh from Google
              </button>
            </div>
          </div>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 pt-8 sm:px-6">
        {sourceTab === 'storyvenue' && listingSlug && publicOrigin && (
          <div className="mb-8 rounded-2xl border border-sky-200/80 bg-gradient-to-br from-sky-50/90 to-white px-4 py-4 sm:px-5 sm:py-5">
            <p className="text-sm font-semibold text-sky-950">Show reviews on your website.</p>
            <p className="mt-1 text-xs leading-relaxed text-sky-900/85">
              Paste this iframe where you want reviews to appear (Wordpress, custom HTML, etc.)
            </p>
            <pre className="mt-3 max-h-40 overflow-x-auto overflow-y-auto rounded-xl border border-sky-100 bg-white/90 p-3 text-[11px] leading-relaxed text-gray-800">
              {`<iframe\n  src="${publicOrigin}/embed/listing-reviews/${listingSlug}"\n  title="Reviews"\n  style="width:100%;min-height:420px;border:0;border-radius:12px"\n  loading="lazy"\n/>`}
            </pre>
            <p className="mt-2 text-[11px] text-sky-800/80">
              Preview:{' '}
              <a
                href={`${publicOrigin}/embed/listing-reviews/${listingSlug}`}
                target="_blank"
                rel="noreferrer"
                className="font-medium underline hover:text-sky-950"
              >
                Open embed page
              </a>
            </p>
          </div>
        )}

        {sourceTab === 'google' && (
          <div className="mb-8 space-y-4">

            {/* ── Connected state ──────────────────────────────────────────── */}
            {googlePlaceInput.trim() && !searchCandidates.length && !urlCandidate && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 size={18} className="shrink-0 text-emerald-600 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-emerald-900">Connected to Google Business</p>
                      <p className="text-xs text-emerald-700 mt-0.5">
                        Reviews auto-sync from Google every 24 hours.
                        {googleFetchedAt && (
                          <> Last synced {new Date(googleFetchedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}.</>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => void loadGoogle(true)}
                      disabled={googleLoading}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      {googleLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                      Refresh now
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setGooglePlaceInput('');
                        setGoogleCache(null);
                        setGoogleFetchedAt(null);
                        setUrlCandidate(null);
                        setMapsUrl('');
                        setUrlErr('');
                        setSearchCandidates([]);
                        setShowSearchBox(false);
                        autoSearchDoneRef.current = false;
                      }}
                      className="text-xs text-emerald-700 underline hover:text-emerald-900"
                    >
                      Change business
                    </button>
                  </div>
                </div>
                {googleSaveErr && (
                  <p className="mt-2 text-xs text-red-600 flex items-center gap-1"><AlertCircle size={12} />{googleSaveErr}</p>
                )}
              </div>
            )}

            {/* ── Paste Google Maps link — primary setup path ──────────────── */}
            {!googlePlaceInput.trim() && !urlCandidate && (
              <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
                <div>
                  <p className="text-sm font-semibold text-gray-900">Connect your Google Business Profile</p>
                  <p className="mt-1 text-xs text-gray-500 leading-relaxed">
                    Open your business on Google Maps, then copy the URL from the address bar and paste it below.
                  </p>
                  {/* Step visual */}
                  <div className="mt-3 flex items-start gap-6 text-xs text-gray-500">
                    {[
                      { n: '1', text: 'Search your business on Google Maps' },
                      { n: '2', text: 'Click on your listing to open it' },
                      { n: '3', text: 'Copy the URL and paste it below' },
                    ].map(s => (
                      <div key={s.n} className="flex items-start gap-2">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-900 text-[10px] font-bold text-white">{s.n}</span>
                        <span className="leading-tight">{s.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <input
                    value={mapsUrl}
                    onChange={(e) => { setMapsUrl(e.target.value); setUrlErr(''); setUrlCandidate(null); }}
                    onPaste={(e) => {
                      const pasted = e.clipboardData.getData('text').trim();
                      if (pasted) setTimeout(() => void resolveUrl(pasted), 50);
                    }}
                    placeholder="https://maps.app.goo.gl/… or https://www.google.com/maps/place/…"
                    className="flex-1 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm focus:border-gray-400 focus:bg-white focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => { if (mapsUrl.trim()) void resolveUrl(mapsUrl.trim()); }}
                    disabled={urlLoading || !mapsUrl.trim()}
                    className="shrink-0 rounded-xl bg-[#1b1b1b] px-4 py-2.5 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
                  >
                    {urlLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Find'}
                  </button>
                </div>
                {urlErr && (
                  <p className="flex items-start gap-1.5 text-xs text-red-600">
                    <AlertCircle size={13} className="mt-0.5 shrink-0" />{urlErr}
                  </p>
                )}
                <div className="border-t border-gray-100 pt-3 flex items-center justify-between">
                  <p className="text-[11px] text-gray-400">Can&apos;t find your listing? Try the name search instead.</p>
                  <button
                    type="button"
                    onClick={() => { setShowSearchBox(true); setTimeout(() => searchInputRef.current?.focus(), 50); }}
                    className="text-[11px] text-gray-600 underline hover:text-gray-900"
                  >
                    Search by name
                  </button>
                </div>
              </div>
            )}

            {/* ── URL candidate confirm card ────────────────────────────────── */}
            {urlCandidate && !googlePlaceInput.trim() && (
              <div className="space-y-3">
                <p className="text-sm font-semibold text-gray-700">Is this your business?</p>
                <div className="flex items-start justify-between gap-4 rounded-2xl border border-gray-200 bg-white px-5 py-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{urlCandidate.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{urlCandidate.formatted_address}</p>
                    {urlCandidate.rating != null && (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <StarsDisplay value={Math.round(urlCandidate.rating)} size="sm" />
                        <span className="text-xs text-gray-500">
                          {urlCandidate.rating.toFixed(1)}
                          {urlCandidate.user_ratings_total != null && <> · {urlCandidate.user_ratings_total.toLocaleString()} reviews</>}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => void confirmCandidate(urlCandidate)}
                      disabled={confirmingId === urlCandidate.place_id}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[#1b1b1b] px-4 py-2 text-xs font-semibold text-white hover:bg-neutral-800 disabled:opacity-50 whitespace-nowrap"
                    >
                      {confirmingId === urlCandidate.place_id
                        ? <><Loader2 className="h-3 w-3 animate-spin" />Connecting…</>
                        : <>Yes, connect it</>}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setUrlCandidate(null); setMapsUrl(''); }}
                      className="text-xs text-gray-500 underline text-center hover:text-gray-800"
                    >
                      Not right
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Auto-search loading ───────────────────────────────────────── */}
            {!googlePlaceInput.trim() && !urlCandidate && searchLoading && (
              <div className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-white px-5 py-5">
                <Loader2 className="h-5 w-5 animate-spin text-gray-400 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-gray-700">Finding your Google Business Profile…</p>
                  <p className="text-xs text-gray-400 mt-0.5">Searching based on your venue name and location</p>
                </div>
              </div>
            )}

            {/* ── Candidate cards ───────────────────────────────────────────── */}
            {!googlePlaceInput.trim() && !urlCandidate && !searchLoading && searchCandidates.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-700">
                    {searchCandidates.length === 1
                      ? 'Is this your business on Google?'
                      : 'Which one is your business on Google?'}
                  </p>
                  <button
                    type="button"
                    onClick={() => { setShowSearchBox(true); setTimeout(() => searchInputRef.current?.focus(), 50); }}
                    className="text-xs text-gray-500 underline hover:text-gray-800"
                  >
                    Not here? Search manually
                  </button>
                </div>
                {searchCandidates.map((c) => (
                  <div
                    key={c.place_id}
                    className="flex items-start justify-between gap-4 rounded-2xl border border-gray-200 bg-white px-5 py-4 hover:border-gray-300 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{c.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5 truncate">{c.formatted_address}</p>
                      {c.rating != null && (
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <StarsDisplay value={Math.round(c.rating)} size="sm" />
                          <span className="text-xs text-gray-500">
                            {c.rating.toFixed(1)}
                            {c.user_ratings_total != null && <> · {c.user_ratings_total.toLocaleString()} reviews</>}
                          </span>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => void confirmCandidate(c)}
                      disabled={confirmingId === c.place_id}
                      className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-[#1b1b1b] px-4 py-2 text-xs font-semibold text-white hover:bg-neutral-800 disabled:opacity-50 whitespace-nowrap"
                    >
                      {confirmingId === c.place_id
                        ? <><Loader2 className="h-3 w-3 animate-spin" />Connecting…</>
                        : <>Yes, that&apos;s us</>
                      }
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* ── Error from auto-search ────────────────────────────────────── */}
            {!googlePlaceInput.trim() && !urlCandidate && !searchLoading && searchErr && !searchCandidates.length && (
              <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
                <AlertCircle size={16} className="shrink-0 text-amber-600 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-900">{searchErr}</p>
                  <button
                    type="button"
                    onClick={() => { setShowSearchBox(true); setTimeout(() => searchInputRef.current?.focus(), 50); }}
                    className="mt-1 text-xs text-amber-800 underline"
                  >
                    Search manually instead
                  </button>
                </div>
              </div>
            )}

            {/* ── Manual search box ─────────────────────────────────────────── */}
            {!urlCandidate && (showSearchBox || (!googlePlaceInput.trim() && !searchLoading && searchCandidates.length === 0 && !searchErr)) && showSearchBox && (
              <form onSubmit={handleSearchSubmit} className="flex gap-2">
                <div className="relative flex-1">
                  <Search size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    ref={searchInputRef}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by business name, address, or city…"
                    className="w-full rounded-2xl border border-gray-200 bg-gray-50 py-3 pl-9 pr-4 text-sm focus:border-gray-400 focus:bg-white focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={searchLoading || !searchQuery.trim()}
                  className="shrink-0 rounded-2xl bg-[#1b1b1b] px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
                >
                  {searchLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
                </button>
              </form>
            )}

            {/* ── Advanced: manual Place ID input ───────────────────────────── */}
            <div className="rounded-2xl border border-gray-100 bg-gray-50">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex w-full items-center justify-between px-4 py-3 text-xs font-medium text-gray-500 hover:text-gray-700"
              >
                <span>Advanced: enter Place ID manually</span>
                <ChevronDown size={14} className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
              </button>
              {showAdvanced && (
                <div className="border-t border-gray-100 px-4 pb-4 pt-3 space-y-3">
                  <p className="text-xs text-gray-500 leading-relaxed">
                    Find your Place ID using{' '}
                    <a
                      href="https://developers.google.com/maps/documentation/javascript/examples/places-placeid-finder"
                      target="_blank"
                      rel="noreferrer"
                      className="underline text-gray-700 inline-flex items-center gap-0.5"
                    >
                      Google&apos;s Place ID finder<ExternalLink size={10} className="inline" />
                    </a>
                    {' '}(search for your business name, then copy the ID).
                  </p>
                  <input
                    value={googlePlaceInput}
                    onChange={(e) => setGooglePlaceInput(e.target.value)}
                    placeholder="ChIJN1t_tDeuEmsRUsoyG83frY4"
                    className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm focus:border-gray-400 focus:outline-none"
                  />
                  {googleSaveErr && !googlePlaceInput.trim() && (
                    <p className="text-xs text-red-600">{googleSaveErr}</p>
                  )}
                  <button
                    type="button"
                    onClick={() => void saveGooglePlace()}
                    disabled={googleSaving || !googlePlaceInput.trim()}
                    className="rounded-xl bg-[#1b1b1b] px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
                  >
                    {googleSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save & sync'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {sourceTab === 'google' && (
          <div className="mb-10 space-y-4">
            {googleLoading && !googleCache && (
              <div className="flex justify-center py-8 text-gray-400">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            )}
            {!googleLoading &&
              (googleCache?.reviews?.length ? (
                <ul className="space-y-4">
                  {googleCache.reviews.map((r, i) => (
                    <li
                      key={`${r.author_name}-${i}`}
                      className="rounded-3xl border border-gray-200/90 bg-white p-6"
                    >
                      <div className="flex items-start gap-3">
                        {r.profile_photo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={r.profile_photo_url}
                            alt={r.author_name}
                            className="h-9 w-9 rounded-full object-cover shrink-0"
                          />
                        ) : (
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-500">
                            {r.author_name.charAt(0).toUpperCase()}
                          </span>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-gray-800">{r.author_name}</span>
                            {r.published_at && (
                              <span className="text-xs text-gray-400">
                                {new Date(r.published_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                              </span>
                            )}
                          </div>
                          <StarsDisplay value={r.rating} size="sm" />
                          <p className="mt-2 text-[14px] leading-relaxed text-gray-700">{r.text}</p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : googlePlaceInput.trim() ? (
                <p className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/80 px-4 py-10 text-center text-sm text-gray-500">
                  No reviews returned yet — click &quot;Refresh now&quot; above to re-fetch from Google.
                </p>
              ) : null)}
          </div>
        )}

        {sourceTab === 'storyvenue' && (
          <>
        <div className="mb-6 flex flex-wrap gap-2">
          {FILTER_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setFilter(t.id)}
              className={classNames(
                'rounded-full px-4 py-2 text-xs font-semibold transition-colors',
                filter === t.id
                  ? 'bg-gray-900 text-white'
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-24 text-gray-400">
            <Loader2 className="h-10 w-10 animate-spin" />
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-gray-300 bg-white/60 px-6 py-20 text-center">
            <MessageSquareQuote className="mb-4 text-gray-300" size={48} strokeWidth={1.25} />
            <p className="font-heading text-xl text-gray-800">No reviews yet</p>
            <p className="mt-2 max-w-md text-sm text-gray-500">
              Add your first testimonial to build trust on your listing. You can always edit visibility or remove
              reviews later.
            </p>
            <button
              type="button"
              onClick={() => setShowComposer(true)}
              className="mt-6 rounded-2xl bg-[#1b1b1b] px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-800"
            >
              Add a review
            </button>
          </div>
        ) : (
          <ul className="space-y-4">
            {filtered.map((r) => (
              <li
                key={r.id}
                className="relative rounded-3xl border border-gray-200/90 bg-white p-6 transition-colors hover:border-gray-300"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <StarsDisplay value={r.rating} />
                    {r.title && (
                      <h2 className="mt-3 font-heading text-lg text-gray-900">{r.title}</h2>
                    )}
                    <blockquote className="mt-2 text-[15px] leading-relaxed text-gray-700">
                      <span className="text-3xl leading-none text-gray-200">“</span>
                      {r.body}
                      <span className="text-3xl leading-none text-gray-200">”</span>
                    </blockquote>
                    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                      <span className="font-semibold text-gray-800">{r.reviewer_name}</span>
                      {r.wedding_date && (
                        <span className="inline-flex items-center gap-1">
                          <Calendar size={12} />
                          {new Date(r.wedding_date + 'T12:00:00').toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </span>
                      )}
                      <span>
                        {new Date(r.created_at).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </span>
                    </div>
                  </div>
                  <div className="relative flex items-start gap-2">
                    <span
                      className={classNames(
                        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide',
                        r.status === 'published' && 'border border-emerald-200/80 bg-emerald-50 text-emerald-800',
                        r.status === 'pending' && 'border border-amber-200/80 bg-amber-50 text-amber-900',
                        r.status === 'hidden' && 'border border-gray-200 bg-gray-100 text-gray-600',
                      )}
                    >
                      {r.status === 'pending' && <Clock size={10} />}
                      {r.status}
                    </span>
                    <button
                      type="button"
                      className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                      aria-label="Review actions"
                      onClick={() => setOpenMenuId((id) => (id === r.id ? null : r.id))}
                    >
                      <MoreHorizontal size={18} />
                    </button>
                    {openMenuId === r.id && (
                      <div className="absolute right-0 top-9 z-10 w-48 rounded-xl border border-gray-200 bg-white py-1 text-sm">
                        {r.status !== 'published' && (
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-50"
                            onClick={() => patchStatus(r.id, 'published')}
                          >
                            <Eye size={14} /> Publish
                          </button>
                        )}
                        {r.status !== 'hidden' && (
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-50"
                            onClick={() => patchStatus(r.id, 'hidden')}
                          >
                            <EyeOff size={14} /> Hide
                          </button>
                        )}
                        {r.status !== 'pending' && (
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-50"
                            onClick={() => patchStatus(r.id, 'pending')}
                          >
                            <Clock size={14} /> Mark pending
                          </button>
                        )}
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-red-600 hover:bg-red-50"
                          onClick={() => removeReview(r.id)}
                        >
                          <Trash2 size={14} /> Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
          </>
        )}
      </div>

      {showComposer && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          onClick={() => setShowComposer(false)}
          onKeyDown={(e) => e.key === 'Escape' && setShowComposer(false)}
          role="presentation"
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-gray-200 bg-white sm:rounded-3xl"
            role="dialog"
            onClick={(e) => e.stopPropagation()}
            aria-modal
            aria-labelledby="review-dialog-title"
          >
            <div className="border-b border-gray-100 px-6 py-4">
              <h2 id="review-dialog-title" className="font-heading text-xl text-gray-900">
                New review
              </h2>
              <p className="mt-1 text-sm text-gray-500">Shown on your listing when published.</p>
            </div>
            <form onSubmit={submitReview} className="space-y-4 px-6 py-5">
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Rating
                </label>
                <StarPicker value={rating} onChange={setRating} />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Couple / reviewer name
                </label>
                <input
                  value={reviewerName}
                  onChange={(e) => setReviewerName(e.target.value)}
                  className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm focus:border-gray-400 focus:bg-white focus:outline-none"
                  placeholder="Jordan & Taylor"
                  required
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Title <span className="font-normal normal-case text-gray-400">(optional)</span>
                </label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm focus:border-gray-400 focus:bg-white focus:outline-none"
                  placeholder="Our perfect day"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Review
                </label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={5}
                  className="w-full resize-none rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm focus:border-gray-400 focus:bg-white focus:outline-none"
                  placeholder="What stood out about working with your venue?"
                  required
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Wedding date <span className="font-normal normal-case text-gray-400">(optional)</span>
                  </label>
                  <input
                    type="date"
                    value={weddingDate}
                    onChange={(e) => setWeddingDate(e.target.value)}
                    className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm focus:border-gray-400 focus:bg-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Email <span className="font-normal normal-case text-gray-400">(optional)</span>
                  </label>
                  <input
                    type="email"
                    value={reviewerEmail}
                    onChange={(e) => setReviewerEmail(e.target.value)}
                    className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm focus:border-gray-400 focus:bg-white focus:outline-none"
                    placeholder="For future verification"
                  />
                </div>
              </div>
              {formError && <p className="text-sm text-red-600">{formError}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowComposer(false)}
                  className="rounded-2xl px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-2xl bg-[#1b1b1b] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Save &amp; publish
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
