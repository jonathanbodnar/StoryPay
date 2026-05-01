'use client';

import { useMemo, useState } from 'react';
import { Search, Sparkles, Star } from 'lucide-react';
import { classNames } from '@/lib/utils';

export type StoryReviewRow = {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  reviewer_name: string;
  wedding_date: string | null;
  created_at: string;
};

export type GoogleReviewRow = {
  author_name: string;
  rating: number;
  text: string;
  published_at: string | null;
  profile_photo_url: string | null;
};

export type StoryReviewsBundle = {
  average_rating: number | null;
  count: number;
  items: StoryReviewRow[];
};

export type GoogleReviewsBundle = {
  average_rating: number | null;
  count: number;
  items: GoogleReviewRow[];
};

const AVATAR_BG = ['bg-amber-200', 'bg-orange-200', 'bg-sky-200', 'bg-violet-200', 'bg-emerald-200', 'bg-rose-200'];

function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h + name.charCodeAt(i) * 17) % AVATAR_BG.length;
  return AVATAR_BG[h] ?? AVATAR_BG[0];
}

function StarsRow({ value, size = 16 }: { value: number; size?: number }) {
  const v = Math.min(5, Math.max(1, Math.round(value)));
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={size}
          className={n <= v ? 'fill-amber-400 text-amber-400' : 'fill-gray-100 text-gray-200'}
          strokeWidth={n <= v ? 0 : 1.2}
        />
      ))}
    </span>
  );
}

function GoogleGIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={20} height={20} aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

type SortKey = 'top' | 'new';

function ReviewCardStory({
  r,
  expanded,
  onToggle,
}: {
  r: StoryReviewRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const long = r.body.length > 280;
  const text = expanded || !long ? r.body : `${r.body.slice(0, 280)}…`;
  return (
    <li className="border-b border-gray-100 py-5 last:border-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 gap-3">
          <div
            className={classNames(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-gray-800',
              avatarColor(r.reviewer_name),
            )}
          >
            {(r.reviewer_name || '?').slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-semibold text-gray-900">{r.reviewer_name}</span>
              <span className="text-xs text-gray-400">
                {new Date(r.created_at).toLocaleDateString(undefined, {
                  month: 'numeric',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <StarsRow value={r.rating} />
              <span className="text-xs tabular-nums text-gray-600">{r.rating.toFixed(1)}</span>
            </div>
            {r.title && (
              <h3
                className="mt-2 text-lg text-gray-900"
                style={{ fontFamily: "'Open Sans', -apple-system, sans-serif" }}
              >
                {r.title}
              </h3>
            )}
            <p className="mt-2 text-[15px] leading-relaxed text-gray-700">
              {text}
              {long && (
                <button
                  type="button"
                  onClick={onToggle}
                  className="ml-1 text-sm font-medium text-sky-700 hover:text-sky-900"
                >
                  {expanded ? 'Show less' : 'Read more'}
                </button>
              )}
            </p>
            {r.wedding_date && (
              <p className="mt-2 text-xs text-gray-500">
                Wedding{' '}
                {new Date(r.wedding_date + 'T12:00:00').toLocaleDateString(undefined, {
                  month: 'long',
                  year: 'numeric',
                })}
              </p>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

function ReviewCardGoogle({
  r,
  expanded,
  onToggle,
}: {
  r: GoogleReviewRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const long = r.text.length > 280;
  const text = expanded || !long ? r.text : `${r.text.slice(0, 280)}…`;
  const initial = (r.author_name || '?').slice(0, 1).toUpperCase();
  return (
    <li className="border-b border-gray-100 py-5 last:border-0">
      <div className="flex items-start gap-3">
        {r.profile_photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={r.profile_photo_url}
            alt=""
            className="h-10 w-10 shrink-0 rounded-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div
            className={classNames(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-gray-800',
              avatarColor(r.author_name),
            )}
          >
            {initial}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-semibold text-gray-900">{r.author_name}</span>
            <span className="text-xs text-gray-400">
              {r.published_at
                ? new Date(r.published_at).toLocaleDateString(undefined, {
                    month: 'numeric',
                    day: 'numeric',
                    year: 'numeric',
                  })
                : '—'}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <StarsRow value={r.rating} />
            <span className="text-xs tabular-nums text-gray-600">{r.rating.toFixed(1)}</span>
          </div>
          <p className="mt-2 text-[15px] leading-relaxed text-gray-700">
            {text}
            {long && (
              <button
                type="button"
                onClick={onToggle}
                className="ml-1 text-sm font-medium text-sky-700 hover:text-sky-900"
              >
                {expanded ? 'Show less' : 'Read more'}
              </button>
            )}
          </p>
        </div>
      </div>
    </li>
  );
}

export function VenueReviewsTabs({
  venueName,
  storyVenue,
  google,
  compact,
}: {
  venueName: string;
  storyVenue: StoryReviewsBundle;
  google: GoogleReviewsBundle | null;
  compact?: boolean;
}) {
  const hasGoogle = google != null;
  const [tab, setTab] = useState<'story' | 'google'>('story');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('top');
  const [ratingFilter, setRatingFilter] = useState<number | 'all'>('all');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  const storyRounded =
    storyVenue.average_rating != null ? Math.round(storyVenue.average_rating * 10) / 10 : null;
  const googleRounded =
    google?.average_rating != null ? Math.round(google.average_rating * 10) / 10 : null;

  const storyFiltered = useMemo(() => {
    let rows = storyVenue.items;
    const qq = q.trim().toLowerCase();
    if (qq) {
      rows = rows.filter(
        (r) =>
          r.body.toLowerCase().includes(qq) ||
          r.reviewer_name.toLowerCase().includes(qq) ||
          (r.title && r.title.toLowerCase().includes(qq)),
      );
    }
    if (ratingFilter !== 'all') {
      rows = rows.filter((r) => r.rating === ratingFilter);
    }
    const copy = [...rows];
    if (sort === 'new') {
      copy.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    } else {
      copy.sort((a, b) => b.rating - a.rating || new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
    return copy;
  }, [storyVenue.items, q, sort, ratingFilter]);

  const googleFiltered = useMemo(() => {
    if (!google) return [];
    let rows = google.items;
    const qq = q.trim().toLowerCase();
    if (qq) {
      rows = rows.filter(
        (r) => r.text.toLowerCase().includes(qq) || r.author_name.toLowerCase().includes(qq),
      );
    }
    if (ratingFilter !== 'all') {
      rows = rows.filter((r) => r.rating === ratingFilter);
    }
    const copy = [...rows];
    if (sort === 'new') {
      copy.sort(
        (a, b) =>
          (b.published_at ? new Date(b.published_at).getTime() : 0) -
          (a.published_at ? new Date(a.published_at).getTime() : 0),
      );
    } else {
      copy.sort((a, b) => b.rating - a.rating);
    }
    return copy;
  }, [google, q, sort, ratingFilter]);

  const sectionClass = compact ? 'text-gray-900' : 'rounded-3xl border border-gray-200 bg-white p-6';

  return (
    <section id="reviews" className={classNames(sectionClass, 'scroll-mt-28')}>
      <div className="mb-6 flex flex-col gap-3 border-b border-gray-100 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2
            className="text-xl font-semibold tracking-tight text-gray-900 sm:text-2xl"
            style={{ fontFamily: "'Open Sans', -apple-system, sans-serif" }}
          >
            Reviews
          </h2>
          <p className="mt-1 text-sm text-gray-500">Couples who celebrated at {venueName}</p>
        </div>
        {!hasGoogle && storyRounded != null && storyVenue.count > 0 && (
          <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-gray-50/80 px-4 py-3">
            <span
              className="text-3xl tabular-nums text-gray-900"
              style={{ fontFamily: "'Open Sans', -apple-system, sans-serif" }}
            >
              {storyRounded}
            </span>
            <div>
              <StarsRow value={Math.round(storyRounded)} size={16} />
              <p className="text-xs text-gray-500">{storyVenue.count} reviews</p>
            </div>
          </div>
        )}
      </div>

      {hasGoogle && (
        <div className="mb-6 border-b border-gray-200">
          <div className="flex gap-0">
            <button
              type="button"
              onClick={() => setTab('story')}
              className={classNames(
                'flex min-w-0 flex-1 items-center gap-3 border-b-2 px-3 py-3 text-left transition-colors sm:gap-4 sm:px-4',
                tab === 'story' ? 'border-gray-900 bg-white' : 'border-transparent text-gray-500 hover:text-gray-800',
              )}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-900 text-white">
                <Sparkles size={18} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-gray-900">StoryVenue</span>
                <span className="block text-xs text-gray-500">
                  {storyRounded != null ? `${storyRounded}/5` : '—'} · {storyVenue.count} reviews
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => setTab('google')}
              className={classNames(
                'flex min-w-0 flex-1 items-center gap-3 border-b-2 px-3 py-3 text-left transition-colors sm:gap-4 sm:px-4',
                tab === 'google' ? 'border-gray-900 bg-white' : 'border-transparent text-gray-500 hover:text-gray-800',
              )}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white">
                <GoogleGIcon />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-gray-900">Google</span>
                <span className="block text-xs text-gray-500">
                  {googleRounded != null ? `${googleRounded}/5` : '—'} · {google?.count ?? 0} reviews
                </span>
              </span>
            </button>
          </div>
        </div>
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1">
          <input
            type="search"
            placeholder="Search reviews"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full rounded-2xl border border-gray-200 bg-gray-50 py-2.5 pl-3 pr-12 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:bg-white focus:outline-none"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg bg-pink-600 text-white">
            <Search size={16} />
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-gray-500">
            Sort by
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="rounded-xl border border-gray-200 bg-white px-2 py-2 text-sm text-gray-800"
            >
              <option value="top">Top reviews</option>
              <option value="new">Newest</option>
            </select>
          </label>
        </div>
      </div>

      <div className="mb-4">
        <span className="text-xs font-medium text-gray-500">Filter by rating</span>
        <div className="mt-2 flex flex-wrap gap-2">
          {(['all', 5, 4, 3, 2, 1] as const).map((r) => (
            <button
              key={String(r)}
              type="button"
              onClick={() => setRatingFilter(r)}
              className={classNames(
                'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                ratingFilter === r ? 'bg-gray-900 text-white' : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
              )}
            >
              {r === 'all' ? 'All' : `${r}★`}
            </button>
          ))}
        </div>
      </div>

      {(tab === 'story' ? storyFiltered : googleFiltered).length === 0 ? (
        <p className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 px-4 py-12 text-center text-sm text-gray-500">
          {tab === 'google'
            ? 'No Google reviews loaded yet, or none match your filters.'
            : 'No reviews match your filters yet.'}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {tab === 'story'
            ? storyFiltered.map((r) => (
                <ReviewCardStory
                  key={r.id}
                  r={r}
                  expanded={expandedIds.has(r.id)}
                  onToggle={() =>
                    setExpandedIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(r.id)) next.delete(r.id);
                      else next.add(r.id);
                      return next;
                    })
                  }
                />
              ))
            : googleFiltered.map((r, i) => {
                const key = `${r.author_name}-${r.published_at ?? i}-${i}`;
                return (
                  <ReviewCardGoogle
                    key={key}
                    r={r}
                    expanded={expandedIds.has(key)}
                    onToggle={() =>
                      setExpandedIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      })
                    }
                  />
                );
              })}
        </ul>
      )}

      {tab === 'google' && hasGoogle && (
        <p className="mt-4 text-center text-[11px] text-gray-400">Reviews from Google Maps · counts reflect Google data</p>
      )}
    </section>
  );
}
