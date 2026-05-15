'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { SlidersHorizontal, X } from 'lucide-react';
import { LocationAutocomplete, type LocationSuggestion } from '@/components/LocationAutocomplete';
import { DirectoryVenueCard } from '@/components/DirectoryVenueCard';

const API_BASE = process.env.NEXT_PUBLIC_DASHBOARD_URL || 'https://app.storyvenue.com';
const SITE_URL = process.env.NEXT_PUBLIC_DIRECTORY_SITE_URL || 'https://storyvenue.com';

// ── Types ────────────────────────────────────────────────────────────────────

interface VenueRow {
  slug: string;
  name: string;
  location_city: string | null;
  location_state: string | null;
  listing_verified: boolean;
  listing_sponsored: boolean;
}

type BudgetTier = '' | '$' | '$$' | '$$$';

const BUDGET_LABELS: Record<BudgetTier, string> = {
  '':    'Any',
  '$':   'Intimate & Charming',
  '$$':  'Romantic & Refined',
  '$$$': 'Grand & Luxurious',
};

const VENUE_TYPES = [
  'All types',
  'Barn & Farm',
  'Ballroom',
  'Garden & Outdoor',
  'Industrial & Loft',
  'Beach & Waterfront',
  'Historic Estate',
  'Mountain & Vineyard',
  'Hotel & Resort',
];

const SETTINGS = ['Any', 'Indoor', 'Outdoor', 'Indoor + Outdoor'];

const AMENITIES = [
  'Catering in-house',
  'BYOB',
  'On-site lodging',
  'Pet friendly',
  'Rehearsal dinner',
  'Bridal suite',
  'Parking on-site',
  'ADA accessible',
];

// ── Component ────────────────────────────────────────────────────────────────

export default function VenueDirectoryPage() {
  // Filter state
  const [locationRaw, setLocationRaw] = useState('');
  const [locationResolved, setLocationResolved] = useState<{ city: string; state: string }>({ city: '', state: '' });
  const [budget, setBudget]     = useState<BudgetTier>('');
  const [venueType, setVenueType] = useState('All types');
  const [setting, setSetting]   = useState('Any');
  const [amenities, setAmenities] = useState<Set<string>>(new Set());

  // Results + loading
  const [venues, setVenues]     = useState<VenueRow[]>([]);
  const [loading, setLoading]   = useState(false);
  const [searched, setSearched] = useState(false);

  // Mobile filter drawer
  const [drawerOpen, setDrawerOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  const fetchVenues = useCallback(async (city: string, state: string) => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    setSearched(true);
    try {
      const params = new URLSearchParams();
      if (city)  params.set('city',  city);
      if (state) params.set('state', state);
      const res = await fetch(`${API_BASE}/api/public/directory/venues?${params}`, {
        signal: abortRef.current.signal,
      });
      const data = await res.json();
      setVenues(Array.isArray(data.venues) ? data.venues : []);
    } catch (e) {
      if ((e as { name?: string }).name !== 'AbortError') {
        setVenues([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Search whenever resolved location changes
  useEffect(() => {
    if (locationResolved.city || locationResolved.state) {
      void fetchVenues(locationResolved.city, locationResolved.state);
    } else if (searched) {
      setVenues([]);
    }
  }, [locationResolved, fetchVenues, searched]);

  function handleLocationSelect(s: LocationSuggestion) {
    setLocationResolved({ city: s.city, state: s.state });
  }

  function handleReset() {
    setLocationRaw('');
    setLocationResolved({ city: '', state: '' });
    setBudget('');
    setVenueType('All types');
    setSetting('Any');
    setAmenities(new Set());
    setVenues([]);
    setSearched(false);
  }

  function toggleAmenity(a: string) {
    setAmenities((prev) => {
      const next = new Set(prev);
      if (next.has(a)) next.delete(a); else next.add(a);
      return next;
    });
  }

  const hasFilters =
    locationRaw || budget || venueType !== 'All types' ||
    setting !== 'Any' || amenities.size > 0;

  // Client-side amenity/type/setting/budget filter (applied on top of server results)
  const filteredVenues = venues.filter(() => {
    // Budget, venue type, setting, amenities are stored per-venue on the DB but
    // we don't currently return them from the public API — keep as UX affordances
    // that will be wired when the API is extended. For now pass-through.
    return true;
  });

  // ── Filter sidebar (shared between desktop and mobile drawer) ────────────

  const FilterContent = (
    <div className="space-y-6 text-sm">
      {/* Location */}
      <div>
        <p className="mb-2 font-semibold text-gray-900">Location</p>
        <LocationAutocomplete
          value={locationRaw}
          onChange={setLocationRaw}
          onSelect={handleLocationSelect}
          placeholder="City, state, or zip…"
        />
      </div>

      {/* Budget */}
      <div>
        <p className="mb-2 font-semibold text-gray-900">Budget</p>
        <div className="flex gap-2">
          {(['$', '$$', '$$$'] as BudgetTier[]).map((tier) => (
            <button
              key={tier}
              type="button"
              onClick={() => setBudget((v) => (v === tier ? '' : tier))}
              title={BUDGET_LABELS[tier]}
              className={[
                'flex-1 rounded-xl border py-2 text-xs font-semibold transition-colors',
                budget === tier
                  ? 'border-gray-900 bg-gray-900 text-white'
                  : 'border-gray-200 bg-white text-gray-700 hover:border-gray-400',
              ].join(' ')}
            >
              <div>{tier}</div>
              <div className="mt-0.5 text-[10px] font-normal opacity-75">
                {tier === '$' ? 'Intimate & Charming' : tier === '$$' ? 'Romantic & Refined' : 'Grand & Luxurious'}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Venue type */}
      <div>
        <p className="mb-2 font-semibold text-gray-900">Venue Type</p>
        <div className="relative">
          <select
            value={venueType}
            onChange={(e) => setVenueType(e.target.value)}
            className="w-full appearance-none rounded-xl border border-gray-200 bg-white py-2.5 pl-3 pr-8 text-sm text-gray-900 focus:border-gray-400 focus:outline-none"
          >
            {VENUE_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">▾</span>
        </div>
      </div>

      {/* Setting */}
      <div>
        <p className="mb-2 font-semibold text-gray-900">Setting</p>
        <div className="relative">
          <select
            value={setting}
            onChange={(e) => setSetting(e.target.value)}
            className="w-full appearance-none rounded-xl border border-gray-200 bg-white py-2.5 pl-3 pr-8 text-sm text-gray-900 focus:border-gray-400 focus:outline-none"
          >
            {SETTINGS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">▾</span>
        </div>
      </div>

      {/* Amenities */}
      <div>
        <p className="mb-2 font-semibold text-gray-900">Amenities</p>
        <div className="space-y-2">
          {AMENITIES.map((a) => (
            <label key={a} className="flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                checked={amenities.has(a)}
                onChange={() => toggleAmenity(a)}
                className="h-4 w-4 cursor-pointer rounded border-gray-300 accent-gray-900"
              />
              <span className="text-gray-700">{a}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Nav */}
      <nav className="sticky top-0 z-20 border-b border-gray-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <Link href="/">
            <Image src="/storyvenue-logo-dark.png" alt="StoryVenue" width={120} height={28} />
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href={`${SITE_URL.replace(/\/$/, '')}/couple/login`}
              className="text-sm text-gray-500 hover:text-gray-800"
            >
              Sign in
            </Link>
            <Link
              href={`${SITE_URL.replace(/\/$/, '')}/couple/signup`}
              className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700"
            >
              Get started
            </Link>
          </div>
        </div>
      </nav>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Page header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {locationResolved.state
                ? `Wedding Venues in ${locationResolved.city ? `${locationResolved.city}, ` : ''}${locationResolved.state}`
                : 'Find Your Perfect Wedding Venue'}
            </h1>
            {searched && !loading && (
              <p className="mt-1 text-sm text-gray-500">
                {filteredVenues.length} {filteredVenues.length === 1 ? 'result' : 'results'}
              </p>
            )}
          </div>

          {/* Mobile filter toggle */}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm lg:hidden"
          >
            <SlidersHorizontal size={15} />
            Filters
            {hasFilters && (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-900 text-[10px] font-bold text-white">
                {[locationRaw, budget, venueType !== 'All types', setting !== 'Any', amenities.size > 0].filter(Boolean).length}
              </span>
            )}
          </button>
        </div>

        <div className="flex gap-6">
          {/* Desktop sidebar */}
          <aside className="hidden w-56 shrink-0 lg:block">
            <div className="sticky top-20 rounded-2xl border border-gray-200 bg-white p-5">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-base font-bold text-gray-900">Filters</h2>
                {hasFilters && (
                  <button
                    type="button"
                    onClick={handleReset}
                    className="text-xs font-medium text-blue-600 hover:text-blue-800"
                  >
                    Reset
                  </button>
                )}
              </div>
              {FilterContent}
            </div>
          </aside>

          {/* Results */}
          <main className="min-w-0 flex-1">
            {loading ? (
              <div className="flex items-center justify-center py-20 text-gray-400">
                <svg className="h-6 w-6 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                <span className="ml-2 text-sm">Searching venues…</span>
              </div>
            ) : !searched ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
                  <svg viewBox="0 0 24 24" className="h-8 w-8 text-gray-400" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                  </svg>
                </div>
                <p className="text-base font-semibold text-gray-900">Search by location</p>
                <p className="mt-1 max-w-xs text-sm text-gray-500">
                  Enter a city, state, or zip code in the Filters panel to discover wedding venues near you.
                </p>
              </div>
            ) : filteredVenues.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <p className="text-base font-semibold text-gray-900">No venues found</p>
                <p className="mt-1 text-sm text-gray-500">
                  Try a different city or state, or{' '}
                  <button type="button" onClick={handleReset} className="text-blue-600 underline">
                    reset filters
                  </button>
                  .
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {filteredVenues.map((v) => (
                  <div key={v.slug}>
                    <DirectoryVenueCard
                      name={v.name}
                      slug={v.slug}
                      listing_verified={v.listing_verified}
                      listing_sponsored={v.listing_sponsored}
                      siteUrl={SITE_URL}
                    />
                    {(v.location_city || v.location_state) && (
                      <p className="mt-1 pl-1 text-xs text-gray-400">
                        {[v.location_city, v.location_state].filter(Boolean).join(', ')}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </main>
        </div>
      </div>

      {/* Mobile filter drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} />
          <div className="relative ml-auto h-full w-80 max-w-full overflow-y-auto bg-white p-5 shadow-xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-base font-bold text-gray-900">Filters</h2>
              <div className="flex items-center gap-3">
                {hasFilters && (
                  <button type="button" onClick={handleReset} className="text-xs font-medium text-blue-600">
                    Reset
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="rounded-full p-1 text-gray-500 hover:bg-gray-100"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            {FilterContent}
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="mt-6 w-full rounded-xl bg-gray-900 py-3 text-sm font-semibold text-white"
            >
              Show {filteredVenues.length} results
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
