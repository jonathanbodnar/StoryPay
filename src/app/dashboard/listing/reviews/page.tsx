'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Calendar,
  Loader2,
  MessageSquareQuote,
  MoreHorizontal,
  Plus,
  Sparkles,
  Star,
  Trash2,
  Eye,
  EyeOff,
  Clock,
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
            <button
              type="button"
              onClick={() => {
                setShowComposer(true);
                setFormError('');
              }}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl bg-[#1b1b1b] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-neutral-800"
            >
              <Plus size={18} />
              Add review
            </button>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-3xl border border-gray-200/80 bg-white/90 p-6 shadow-sm backdrop-blur-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Average (published)</p>
              <div className="mt-2 flex items-baseline gap-3">
                <span className="font-heading text-4xl text-gray-900">
                  {stats.n === 0 ? '—' : stats.avg.toFixed(1)}
                </span>
                {stats.n > 0 && <StarsDisplay value={Math.round(stats.avg)} size="md" />}
              </div>
              <p className="mt-2 text-sm text-gray-500">{stats.n} published review{stats.n === 1 ? '' : 's'}</p>
            </div>

            <div className="rounded-3xl border border-gray-200/80 bg-white/90 p-6 shadow-sm backdrop-blur sm:col-span-2 lg:col-span-2">
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
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 pt-8 sm:px-6">
        {listingSlug && publicOrigin && (
          <div className="mb-8 rounded-2xl border border-sky-200/80 bg-gradient-to-br from-sky-50/90 to-white px-4 py-4 sm:px-5 sm:py-5">
            <p className="text-sm font-semibold text-sky-950">Show reviews on storyvenue.com</p>
            <p className="mt-1 text-xs leading-relaxed text-sky-900/85">
              The live directory site (e.g.{' '}
              <span className="font-mono text-[11px]">storyvenue.com/venue/{listingSlug}</span>) is built separately.
              Paste this iframe where you want reviews to appear (Webflow, custom HTML, etc.):
            </p>
            <pre className="mt-3 max-h-40 overflow-x-auto overflow-y-auto rounded-xl bg-white/90 p-3 text-[11px] leading-relaxed text-gray-800 shadow-inner ring-1 ring-sky-100">
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
                  : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50',
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
                className="relative rounded-3xl border border-gray-200/90 bg-white p-6 shadow-sm transition hover:shadow-md"
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
                        r.status === 'published' && 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200/80',
                        r.status === 'pending' && 'bg-amber-50 text-amber-900 ring-1 ring-amber-200/80',
                        r.status === 'hidden' && 'bg-gray-100 text-gray-600 ring-1 ring-gray-200',
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
                      <div className="absolute right-0 top-9 z-10 w-48 rounded-xl border border-gray-200 bg-white py-1 text-sm shadow-lg">
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
      </div>

      {showComposer && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          onClick={() => setShowComposer(false)}
          onKeyDown={(e) => e.key === 'Escape' && setShowComposer(false)}
          role="presentation"
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
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
