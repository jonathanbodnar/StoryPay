'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2, Save, CheckCircle2, Store, Globe, MapPin, Users, DollarSign,
  Image as ImageIcon, ExternalLink, Eye, EyeOff, AlertCircle, RotateCcw,
  Link2, HelpCircle, Plus, Trash2, ChevronDown,
} from 'lucide-react';
import { slugify } from '@/lib/directory';

type FaqRow = { question: string; answer: string };

type SocialLinks = {
  facebook?: string;
  instagram?: string;
  tiktok?: string;
  pinterest?: string;
  website?: string;
};

interface Listing {
  id: string | null;
  slug: string | null;
  name: string | null;
  description: string | null;
  venue_type: string | null;
  location_full: string | null;
  location_city: string | null;
  location_state: string | null;
  lat: number | null;
  lng: number | null;
  capacity_min: number | null;
  capacity_max: number | null;
  price_min: number | null;
  price_max: number | null;
  indoor_outdoor: string | null;
  features: string[];
  cover_image_url: string | null;
  gallery_images: string[];
  availability_notes: string | null;
  is_published: boolean;
  onboarding_completed: boolean;
  social_links: SocialLinks;
  faq: FaqRow[];
  show_map: boolean;
  notification_email: string | null;
  notification_phone: string | null;
  email_notifications: boolean;
  brand_email: string | null;
  brand_phone: string | null;
}

const INPUT = 'w-full rounded-2xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:bg-white transition-colors';
const LABEL = 'block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide';
const CARD = 'rounded-3xl border border-gray-200 bg-white p-6 sm:p-8';
const SECTION_TITLE = 'font-heading text-lg text-gray-900 mb-1';
const SECTION_HINT = 'text-sm text-gray-500 mb-5';

const VENUE_TYPES = ['barn', 'ballroom', 'garden', 'winery', 'beach', 'estate', 'rustic', 'modern', 'historic', 'other'];
const INDOOR_OUTDOOR = ['indoor', 'outdoor', 'both'];
const FEATURE_OPTIONS = [
  'Ceremony site', 'Reception site', 'Bridal suite', 'Groom\'s suite',
  'On-site parking', 'Wheelchair accessible', 'In-house catering',
  'BYO catering allowed', 'Bar service', 'Dance floor', 'Overnight accommodations',
  'Pet friendly', 'Outdoor ceremony', 'Tented options',
];

const DIRECTORY_URL = process.env.NEXT_PUBLIC_DIRECTORY_URL ?? 'https://storyvenue.com';

function emptyListing(): Listing {
  return {
    id: null, slug: null, name: null, description: null, venue_type: null,
    location_full: null, location_city: null, location_state: null,
    lat: null, lng: null,
    // Minimum guests defaults to 0 so owners see a concrete value rather
    // than an empty field — venues that accept intimate bookings still
    // show "0–max" instead of a blank where couples expect a number.
    capacity_min: 0, capacity_max: null, price_min: null, price_max: null,
    indoor_outdoor: null, features: [], cover_image_url: null, gallery_images: [],
    availability_notes: null, is_published: false, onboarding_completed: false,
    social_links: {}, faq: [], show_map: true,
    notification_email: null, notification_phone: null, email_notifications: true,
    brand_email: null, brand_phone: null,
  };
}

type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

const AUTOSAVE_DEBOUNCE_MS = 800;

// US state name → USPS two-letter code. Nominatim returns full state names
// ("Ohio") so we normalize them here to match the "State" field's convention.
const US_STATE_ABBR: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC',
  florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
  indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY',
};

type AddressSuggestion = {
  /** OpenStreetMap place id, used as the React key. */
  place_id: string;
  /** Single-line formatted address for the dropdown + "Full address" field. */
  display_name: string;
  /** Parsed USA components used to auto-fill city / state coords. */
  lat: number;
  lng: number;
  city: string;
  state: string;
};

export default function ListingPage() {
  const [listing, setListing] = useState<Listing>(emptyListing());
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState('');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  // Address autocomplete state (see LocationAutocomplete section below).
  const [addrSuggestions, setAddrSuggestions] = useState<AddressSuggestion[]>([]);
  const [addrOpen, setAddrOpen] = useState(false);
  const [addrLoading, setAddrLoading] = useState(false);

  // Which FAQ row is currently expanded in the accordion. null = all collapsed.
  // Newly added rows auto-open so the owner can immediately fill them in; the
  // "Save" button on each row just collapses it (autosave handles persistence).
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  // True until the user manually edits the slug field. While true, the slug
  // auto-tracks the venue name (e.g. "The Barn at New Albany" → "the-barn-at-new-albany").
  const [autoSlug, setAutoSlug] = useState(false);

  // Refs that always point at the latest listing / loading state so the
  // debounced save doesn't have to be recreated on every edit.
  const listingRef = useRef(listing);
  listingRef.current = listing;
  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  const inFlightRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/listing/me', { cache: 'no-store' });
        if (!alive) return;
        if (res.ok) {
          const data = await res.json();
          if (data.listing) {
            const next: Listing = {
              ...emptyListing(),
              ...data.listing,
              features: Array.isArray(data.listing.features) ? data.listing.features : [],
              gallery_images: Array.isArray(data.listing.gallery_images) ? data.listing.gallery_images : [],
              social_links:
                data.listing.social_links && typeof data.listing.social_links === 'object'
                  ? (data.listing.social_links as SocialLinks)
                  : {},
              faq: Array.isArray(data.listing.faq) ? (data.listing.faq as FaqRow[]) : [],
              show_map: data.listing.show_map !== false,
              lat: data.listing.lat != null ? Number(data.listing.lat) : null,
              lng: data.listing.lng != null ? Number(data.listing.lng) : null,
              // Older listings may have a null capacity_min in the DB. The
              // field's contract is "always a concrete number, defaulting
              // to 0", so normalize on read.
              capacity_min: data.listing.capacity_min != null ? Number(data.listing.capacity_min) : 0,
            };
            // If slug is blank or already matches slugify(name), keep auto-mode on
            // so further name edits continue updating the URL. If the user (or a
            // previous session) hand-edited the slug, leave auto-mode off so we
            // don't clobber their choice.
            const expected = next.name ? slugify(next.name) : '';
            const shouldAutoSlug = !next.slug || next.slug === expected;
            // If auto-mode is on and slug is blank, populate it immediately so
            // the field doesn't show empty on load.
            if (shouldAutoSlug && !next.slug && next.name) {
              next.slug = slugify(next.name);
            }
            setListing(next);
            setAutoSlug(shouldAutoSlug);
          }
        } else {
          const data = await res.json().catch(() => ({}));
          setError(data.error ?? `Failed to load listing (HTTP ${res.status})`);
          setStatus('error');
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load listing');
        setStatus('error');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Abort any in-flight request when unmounting so we don't leak network.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (inFlightRef.current) inFlightRef.current.abort();
    };
  }, []);

  const doSave = useCallback(async (overrides?: Partial<Listing>): Promise<boolean> => {
    if (loadingRef.current) return false;

    if (inFlightRef.current) inFlightRef.current.abort();
    const controller = new AbortController();
    inFlightRef.current = controller;

    setStatus('saving');
    setError('');

    const payload = { ...listingRef.current, ...(overrides ?? {}) };

    try {
      const res = await fetch('/api/listing/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Failed to save (HTTP ${res.status})`);
      setListing({
        ...emptyListing(),
        ...data.listing,
        features: Array.isArray(data.listing.features) ? data.listing.features : [],
        gallery_images: Array.isArray(data.listing.gallery_images) ? data.listing.gallery_images : [],
        social_links:
          data.listing.social_links && typeof data.listing.social_links === 'object'
            ? (data.listing.social_links as SocialLinks)
            : {},
        faq: Array.isArray(data.listing.faq) ? (data.listing.faq as FaqRow[]) : [],
        show_map: data.listing.show_map !== false,
        lat: data.listing.lat != null ? Number(data.listing.lat) : null,
        lng: data.listing.lng != null ? Number(data.listing.lng) : null,
        capacity_min: data.listing.capacity_min != null ? Number(data.listing.capacity_min) : 0,
      });
      setStatus('saved');
      setLastSavedAt(new Date());
      return true;
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return false;
      setError(e instanceof Error ? e.message : 'Failed to save');
      setStatus('error');
      return false;
    } finally {
      if (inFlightRef.current === controller) inFlightRef.current = null;
    }
  }, []);

  const scheduleAutosave = useCallback(() => {
    if (loadingRef.current) return;
    setStatus('dirty');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void doSave(); }, AUTOSAVE_DEBOUNCE_MS);
  }, [doSave]);

  function update<K extends keyof Listing>(key: K, value: Listing[K]) {
    setListing((prev) => ({ ...prev, [key]: value }));
    scheduleAutosave();
  }

  // Debounced address suggestions, powered by Nominatim (OpenStreetMap). Same
  // provider as the embedded map on the public listing, so the lat/lng we
  // record here lines up perfectly with the pin the couple eventually sees.
  // Re-fires whenever the "Full address" input changes and the dropdown is
  // open; closes when the user picks a suggestion or clicks outside.
  useEffect(() => {
    const q = (listing.location_full ?? '').trim();
    if (!addrOpen || q.length < 4) {
      setAddrSuggestions([]);
      setAddrLoading(false);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setAddrLoading(true);
      try {
        const url =
          `https://nominatim.openstreetmap.org/search` +
          `?q=${encodeURIComponent(q)}` +
          `&format=json&addressdetails=1&limit=5&countrycodes=us`;
        const res = await fetch(url, {
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        type NomAddress = {
          house_number?: string; road?: string; postcode?: string;
          city?: string; town?: string; municipality?: string;
          village?: string; hamlet?: string;
          suburb?: string; county?: string; state?: string;
        };
        type NomItem = {
          place_id: number | string;
          display_name: string;
          lat: string;
          lon: string;
          address?: NomAddress;
        };
        const rows = (await res.json()) as NomItem[];
        if (cancelled) return;

        /** Returns true if a place name is an administrative division, not a mailing city. */
        function isAdminDivision(name: string): boolean {
          return /\b(township|county|borough|parish|district|municipality)\b/i.test(name);
        }

        /** Resolve the proper mailing city from Nominatim address fields. */
        function resolveCity(a: NomAddress): string {
          for (const candidate of [a.city, a.town, a.municipality]) {
            if (candidate && !isAdminDivision(candidate)) return candidate;
          }
          return '';
        }

        /**
         * Build a clean "123 Main St, City, ST 12345" from Nominatim's structured address.
         * Never uses county, township, village, hamlet, or suburb — only proper city/town.
         */
        function buildCleanAddress(a: NomAddress): string {
          const street = [a.house_number, a.road].filter(Boolean).join(' ');
          const cityRaw = resolveCity(a);
          const stateRaw = a.state ?? '';
          const stateCode = US_STATE_ABBR[stateRaw.toLowerCase()] ?? stateRaw;
          const zip = a.postcode ? a.postcode.split('-')[0] : '';
          const cityLine = [cityRaw, stateCode ? (zip ? `${stateCode} ${zip}` : stateCode) : zip]
            .filter(Boolean).join(', ');
          return [street, cityLine].filter(Boolean).join(', ');
        }

        const mapped: AddressSuggestion[] = rows.map((r) => {
          const a = r.address ?? {};
          const stateRaw = a.state ?? '';
          return {
            place_id: String(r.place_id),
            display_name: buildCleanAddress(a) || r.display_name,
            lat: parseFloat(r.lat),
            lng: parseFloat(r.lon),
            city: resolveCity(a),
            state: US_STATE_ABBR[stateRaw.toLowerCase()] ?? stateRaw,
          };
        });
        setAddrSuggestions(mapped);
      } catch {
        if (!cancelled) setAddrSuggestions([]);
      } finally {
        if (!cancelled) setAddrLoading(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [listing.location_full, addrOpen]);

  function pickAddress(s: AddressSuggestion) {
    setListing((prev) => ({
      ...prev,
      location_full: s.display_name,
      location_city: s.city || prev.location_city,
      location_state: s.state || prev.location_state,
      lat: Number.isFinite(s.lat) ? s.lat : prev.lat,
      lng: Number.isFinite(s.lng) ? s.lng : prev.lng,
    }));
    setAddrOpen(false);
    setAddrSuggestions([]);
    scheduleAutosave();
  }

  function updateName(value: string) {
    setListing((prev) => {
      const next = { ...prev, name: value };
      if (autoSlug) next.slug = slugify(value);
      return next;
    });
    scheduleAutosave();
  }

  function updateSlug(value: string) {
    // Sanitize as the user types so they can never end up with spaces / weird
    // characters / uppercase, but DON'T force a final hyphen collapse yet so
    // "the-barn-" is still editable into "the-barn-at-new-albany".
    const cleaned = value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .slice(0, 80);
    setAutoSlug(false);
    setListing((prev) => ({ ...prev, slug: cleaned }));
    scheduleAutosave();
  }

  function resetSlugFromName() {
    setAutoSlug(true);
    setListing((prev) => ({ ...prev, slug: prev.name ? slugify(prev.name) : null }));
    scheduleAutosave();
  }

  function toggleFeature(feat: string) {
    setListing((prev) => {
      const has = prev.features.includes(feat);
      return { ...prev, features: has ? prev.features.filter(f => f !== feat) : [...prev.features, feat] };
    });
    scheduleAutosave();
  }

  function updateSocial(key: keyof SocialLinks, value: string) {
    setListing((prev) => {
      const next = { ...prev.social_links };
      if (!value) delete next[key];
      else next[key] = value;
      return { ...prev, social_links: next };
    });
    scheduleAutosave();
  }

  function addFaq() {
    setListing((prev) => {
      const faq = [...prev.faq, { question: '', answer: '' }];
      // Open the row we just added so the owner can start typing immediately.
      setOpenFaq(faq.length - 1);
      return { ...prev, faq };
    });
    scheduleAutosave();
  }

  function updateFaqRow(index: number, field: 'question' | 'answer', value: string) {
    setListing((prev) => {
      const faq = prev.faq.map((row, i) =>
        i === index ? { ...row, [field]: value } : row,
      );
      return { ...prev, faq };
    });
    scheduleAutosave();
  }

  function removeFaqRow(index: number) {
    setListing((prev) => ({ ...prev, faq: prev.faq.filter((_, i) => i !== index) }));
    // If we removed the currently-open row (or a row before it), reindex the
    // "open" pointer so the accordion stays consistent.
    setOpenFaq((cur) => {
      if (cur == null) return cur;
      if (cur === index) return null;
      return cur > index ? cur - 1 : cur;
    });
    scheduleAutosave();
  }

  // Flush a pending autosave and save immediately (e.g. button clicks, page leave).
  const flushAndSave = useCallback(async (overrides?: Partial<Listing>): Promise<boolean> => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    return doSave(overrides);
  }, [doSave]);

  // Best-effort flush on tab close / navigate away.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (status === 'dirty' || status === 'saving') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [status]);

  async function save(nextPublished?: boolean) {
    await flushAndSave(
      typeof nextPublished === 'boolean' ? { is_published: nextPublished } : undefined,
    );
  }

  const publicUrl = useMemo(() => {
    if (!listing.slug) return null;
    return `${DIRECTORY_URL}/venue/${listing.slug}`;
  }, [listing.slug]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl text-gray-900 flex items-center gap-2">
            <Store className="w-6 h-6" /> Listing dashboard
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage how your venue appears on <a href={DIRECTORY_URL} target="_blank" rel="noreferrer" className="underline">storyvenue.com</a>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {publicUrl && (
            <a
              href={publicUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <ExternalLink className="w-3.5 h-3.5" /> View public page
            </a>
          )}
          <button
            onClick={() => save(!listing.is_published)}
            disabled={status === 'saving'}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition-colors ${
              listing.is_published
                ? 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                : 'text-white'
            }`}
            style={listing.is_published ? undefined : { backgroundColor: '#1b1b1b' }}
          >
            {listing.is_published ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {listing.is_published ? 'Unpublish' : 'Publish'}
          </button>
        </div>
      </header>

      {status === 'error' && error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start justify-between gap-3">
          <span className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </span>
          <button
            onClick={() => { void flushAndSave(); }}
            className="text-xs font-semibold underline underline-offset-2 hover:no-underline"
          >
            Retry
          </button>
        </div>
      )}

      <section className={CARD}>
        <h2 className={SECTION_TITLE}>Basics</h2>
        <p className={SECTION_HINT}>Your venue name and URL slug.</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL}>Venue name</label>
            <input
              type="text"
              className={INPUT}
              value={listing.name ?? ''}
              onChange={(e) => updateName(e.target.value)}
              placeholder="The Maple Barn"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className={`${LABEL} mb-0`}>URL slug</label>
              {!autoSlug && listing.name && (
                <button
                  type="button"
                  onClick={resetSlugFromName}
                  className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 hover:text-gray-700"
                  title="Reset slug from venue name"
                >
                  <RotateCcw className="w-3 h-3" /> Auto
                </button>
              )}
            </div>
            <div className="flex items-center rounded-2xl border border-gray-200 bg-gray-50 focus-within:border-gray-400 focus-within:bg-white transition-colors">
              <span className="pl-3.5 pr-1 text-sm text-gray-400 whitespace-nowrap">{DIRECTORY_URL.replace(/^https?:\/\//, '')}/venue/</span>
              <input
                type="text"
                className="flex-1 bg-transparent px-1 py-2.5 text-sm text-gray-900 focus:outline-none"
                value={listing.slug ?? ''}
                onChange={(e) => updateSlug(e.target.value)}
                placeholder="the-maple-barn"
              />
            </div>
            <p className="mt-1.5 text-xs text-gray-400">
              {autoSlug
                ? 'Auto-generated from your venue name.'
                : 'Lowercase letters, numbers, and dashes only.'}
            </p>
          </div>
          <div>
            <label className={LABEL}>Venue type</label>
            <select
              className={INPUT}
              value={listing.venue_type ?? ''}
              onChange={(e) => update('venue_type', e.target.value || null)}
            >
              <option value="">Select</option>
              {VENUE_TYPES.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
            </select>
          </div>
          <div>
            <label className={LABEL}>Indoor / outdoor</label>
            <select
              className={INPUT}
              value={listing.indoor_outdoor ?? ''}
              onChange={(e) => update('indoor_outdoor', e.target.value || null)}
            >
              <option value="">Select</option>
              {INDOOR_OUTDOOR.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
            </select>
          </div>
        </div>
      </section>

      <section className={CARD}>
        <h2 className={SECTION_TITLE}><Store className="inline w-4 h-4 -mt-0.5" /> Contact info</h2>
        <p className={SECTION_HINT}>Public email and phone shown on your storyvenue.com listing so couples can reach you.</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL}>Contact email</label>
            <input
              type="email"
              className={INPUT}
              value={listing.brand_email ?? ''}
              onChange={(e) => update('brand_email', e.target.value || null)}
              placeholder="hello@yourvenue.com"
            />
          </div>
          <div>
            <label className={LABEL}>Contact phone</label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-medium text-gray-500">
                +1
              </span>
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                className={`${INPUT} pl-10`}
                value={formatUsLocal(listing.brand_phone)}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D+/g, '').slice(0, 10);
                  update('brand_phone', digits ? `+1${digits}` : null);
                }}
                placeholder="(614) 555-1234"
              />
            </div>
            <p className="mt-1 text-[11px] text-gray-400">USA only — the +1 country code is added automatically.</p>
          </div>
        </div>
      </section>

      <section className={CARD}>
        <h2 className={SECTION_TITLE}><MapPin className="inline w-4 h-4 -mt-0.5" /> Location</h2>
        <p className={SECTION_HINT}>Where couples will find you.</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-6">
          <div className="sm:col-span-4 relative">
            <label className={LABEL}>Full address</label>
            <input
              type="text"
              className={INPUT}
              value={listing.location_full ?? ''}
              onChange={(e) => {
                update('location_full', e.target.value);
                setAddrOpen(true);
              }}
              onFocus={() => setAddrOpen(true)}
              onBlur={() => {
                // Delay so clicks on a suggestion register before we close.
                setTimeout(() => setAddrOpen(false), 150);
              }}
              placeholder="Start typing — we'll find your location on the map"
              autoComplete="off"
            />
            {addrOpen && (listing.location_full ?? '').trim().length >= 4 && (
              <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-lg">
                {addrLoading && addrSuggestions.length === 0 ? (
                  <div className="px-4 py-3 text-xs text-gray-400">Searching…</div>
                ) : addrSuggestions.length === 0 ? (
                  <div className="px-4 py-3 text-xs text-gray-400">No matches — keep typing.</div>
                ) : (
                  <ul className="max-h-64 overflow-auto py-1">
                    {addrSuggestions.map((s) => (
                      <li key={s.place_id}>
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            // Keep the input focused; onBlur's timeout will close.
                            e.preventDefault();
                            pickAddress(s);
                          }}
                          className="flex w-full items-start gap-2 px-3 py-2 text-left text-xs hover: focus:bg-gray-50"
                        >
                          <MapPin className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                          <span className="text-gray-700">{s.display_name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <p className="mt-1 text-[11px] text-gray-400">
              Picking a suggestion auto-fills city, state, latitude, and longitude.
            </p>
          </div>
          <div className="sm:col-span-3">
            <label className={LABEL}>City</label>
            <input
              type="text"
              className={INPUT}
              value={listing.location_city ?? ''}
              onChange={(e) => update('location_city', e.target.value)}
            />
          </div>
          <div className="sm:col-span-3">
            <label className={LABEL}>State</label>
            <input
              type="text"
              className={INPUT}
              value={listing.location_state ?? ''}
              onChange={(e) => update('location_state', e.target.value)}
            />
          </div>
        </div>
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className={LABEL}>Latitude</label>
            <input
              type="text"
              inputMode="decimal"
              className={INPUT}
              value={listing.lat ?? ''}
              onChange={(e) => {
                const v = e.target.value.trim();
                if (!v) {
                  update('lat', null);
                  return;
                }
                const n = parseFloat(v);
                update('lat', Number.isFinite(n) ? n : null);
              }}
              placeholder="e.g. 40.7128"
            />
          </div>
          <div>
            <label className={LABEL}>Longitude</label>
            <input
              type="text"
              inputMode="decimal"
              className={INPUT}
              value={listing.lng ?? ''}
              onChange={(e) => {
                const v = e.target.value.trim();
                if (!v) {
                  update('lng', null);
                  return;
                }
                const n = parseFloat(v);
                update('lng', Number.isFinite(n) ? n : null);
              }}
              placeholder="e.g. -74.0060"
            />
          </div>
          <div className="flex flex-col justify-end pb-1">
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={listing.show_map}
                onChange={(e) => update('show_map', e.target.checked)}
              />
              <span className="text-sm text-gray-700">Show embedded map on public listing</span>
            </label>
            <p className="mt-2 text-xs text-gray-400">Requires both coordinates. Map uses OpenStreetMap.</p>
          </div>
        </div>
      </section>

      <section className={CARD}>
        <h2 className={SECTION_TITLE}><Link2 className="inline w-4 h-4 -mt-0.5" /> Social &amp; web</h2>
        <p className={SECTION_HINT}>Full URLs starting with https:// — shown as icons on your public venue page.</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {(
            [
              ['facebook', 'Facebook'],
              ['instagram', 'Instagram'],
              ['tiktok', 'TikTok'],
              ['pinterest', 'Pinterest'],
              ['website', 'Website'],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <label className={LABEL}>{label}</label>
              <input
                type="url"
                className={INPUT}
                value={listing.social_links[key] ?? ''}
                onChange={(e) => updateSocial(key, e.target.value)}
                placeholder="https://"
              />
            </div>
          ))}
        </div>
      </section>

      <section className={CARD}>
        <h2 className={SECTION_TITLE}><HelpCircle className="inline w-4 h-4 -mt-0.5" /> FAQ</h2>
        <p className={SECTION_HINT}>Questions and answers for couples visiting your venue page. Click an item to edit.</p>
        <div className="space-y-2">
          {listing.faq.map((row, i) => {
            const isOpen = openFaq === i;
            const preview = row.question.trim() || `Item ${i + 1} — click to write a question`;
            return (
              <div
                key={i}
                className={`overflow-hidden rounded-2xl border transition-colors ${
                  isOpen ? 'border-gray-300 bg-white' : 'border-gray-200 bg-gray-50/80'
                }`}
              >
                {/* Collapsed/summary row: click anywhere to toggle. Separate
                    trash button keeps remove action explicit. */}
                <div className="flex items-center gap-2 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setOpenFaq(isOpen ? null : i)}
                    className="flex flex-1 items-center gap-3 text-left"
                    aria-expanded={isOpen}
                  >
                    <ChevronDown
                      className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${
                        isOpen ? 'rotate-180' : ''
                      }`}
                    />
                    <span
                      className={`truncate text-sm ${
                        row.question.trim() ? 'font-medium text-gray-900' : 'italic text-gray-400'
                      }`}
                    >
                      {preview}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeFaqRow(i)}
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
                    aria-label="Remove FAQ item"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                {isOpen && (
                  <div className="border-t border-gray-200 px-4 py-4">
                    <label className={LABEL}>Question</label>
                    <input
                      type="text"
                      className={`${INPUT} mb-3`}
                      value={row.question}
                      onChange={(e) => updateFaqRow(i, 'question', e.target.value)}
                      placeholder="Do you allow outside catering?"
                      autoFocus
                    />
                    <label className={LABEL}>Answer</label>
                    <textarea
                      className={`${INPUT} min-h-[100px]`}
                      value={row.answer}
                      onChange={(e) => updateFaqRow(i, 'answer', e.target.value)}
                      placeholder="We offer in-house catering and can accommodate licensed vendors…"
                    />
                    <div className="mt-3 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => removeFaqRow(i)}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          // Flush the pending autosave so the user knows their
                          // edits are persisted the moment the row collapses.
                          await flushAndSave();
                          setOpenFaq(null);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-white hover:opacity-90"
                        style={{ backgroundColor: '#1b1b1b' }}
                      >
                        <Save className="h-3.5 w-3.5" /> Save
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          <button
            type="button"
            onClick={addFaq}
            className="inline-flex items-center gap-2 rounded-xl border border-dashed border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:border-gray-400"
          >
            <Plus className="h-4 w-4" /> Add FAQ item
          </button>
        </div>
      </section>

      <section className={CARD}>
        <h2 className={SECTION_TITLE}><Users className="inline w-4 h-4 -mt-0.5" /> Capacity &amp; pricing</h2>
        <p className={SECTION_HINT}>Give couples a sense of scale and budget.</p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <label className={LABEL}>Min guests</label>
            <input
              type="number"
              min={0}
              className={INPUT}
              value={listing.capacity_min ?? 0}
              onChange={(e) => {
                // Empty string or a negative value both fall back to 0 so
                // this field can never be left "unset" — matches what
                // couples see on the public listing page.
                const n = e.target.value === '' ? 0 : Number(e.target.value);
                update('capacity_min', Number.isFinite(n) && n >= 0 ? n : 0);
              }}
            />
          </div>
          <div>
            <label className={LABEL}>Max guests</label>
            <input type="number" className={INPUT} value={listing.capacity_max ?? ''}
              onChange={(e) => update('capacity_max', e.target.value ? Number(e.target.value) : null)} />
          </div>
          <div>
            <label className={LABEL}>Price from ($)</label>
            <input type="number" className={INPUT} value={listing.price_min ?? ''}
              onChange={(e) => update('price_min', e.target.value ? Number(e.target.value) : null)} />
          </div>
          <div>
            <label className={LABEL}>Price to ($)</label>
            <input type="number" className={INPUT} value={listing.price_max ?? ''}
              onChange={(e) => update('price_max', e.target.value ? Number(e.target.value) : null)} />
          </div>
        </div>
      </section>

      <section className={CARD}>
        <h2 className={SECTION_TITLE}><Globe className="inline w-4 h-4 -mt-0.5" /> About</h2>
        <p className={SECTION_HINT}>Tell couples why they&apos;ll love getting married here.</p>
        <div className="space-y-4">
          <div>
            <label className={LABEL}>Description</label>
            <textarea
              className={`${INPUT} min-h-[180px]`}
              value={listing.description ?? ''}
              onChange={(e) => update('description', e.target.value)}
              placeholder="A historic barn on 40 acres of rolling pasture..."
            />
          </div>
          <div>
            <label className={LABEL}>Availability notes</label>
            <textarea
              className={`${INPUT} min-h-[80px]`}
              value={listing.availability_notes ?? ''}
              onChange={(e) => update('availability_notes', e.target.value)}
              placeholder="Open May–October. Saturdays booked 9+ months in advance."
            />
          </div>
          <div>
            <label className={LABEL}>Features</label>
            <div className="flex flex-wrap gap-2">
              {FEATURE_OPTIONS.map((feat) => {
                const active = listing.features.includes(feat);
                return (
                  <button
                    key={feat}
                    type="button"
                    onClick={() => toggleFeature(feat)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      active
                        ? 'text-white border-transparent'
                        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                    style={active ? { backgroundColor: '#1b1b1b' } : undefined}
                  >
                    {feat}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className={CARD}>
        <h2 className={SECTION_TITLE}><ImageIcon className="inline w-4 h-4 -mt-0.5" /> Photos</h2>
        <p className={SECTION_HINT}>Your cover image and gallery photos.</p>
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-5">
          <div className="flex items-center gap-4">
            {listing.cover_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={listing.cover_image_url} alt="Cover" className="h-16 w-24 rounded-lg object-cover" />
            ) : (
              <div className="h-16 w-24 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400">
                <ImageIcon className="w-5 h-5" />
              </div>
            )}
            <div className="text-sm">
              <div className="font-medium text-gray-900">
                {listing.gallery_images.length} gallery photo{listing.gallery_images.length === 1 ? '' : 's'}
                {listing.cover_image_url ? ' • cover set' : ' • no cover'}
              </div>
              <div className="text-gray-500">Upload, reorder, and pick your cover.</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/dashboard/media"
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Media
            </Link>
            <Link
              href="/dashboard/listing/images"
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Manage photos
            </Link>
          </div>
        </div>
      </section>

      <section className={CARD}>
        <h2 className={SECTION_TITLE}><DollarSign className="inline w-4 h-4 -mt-0.5" /> Lead notifications</h2>
        <p className={SECTION_HINT}>Where new inquiries from the directory should go.</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL}>Notification email</label>
            <input
              type="email"
              className={INPUT}
              value={listing.notification_email ?? ''}
              onChange={(e) => update('notification_email', e.target.value || null)}
              placeholder="Defaults to your account email"
            />
          </div>
          <div>
            <label className={LABEL}>Notification phone (SMS)</label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-medium text-gray-500">
                +1
              </span>
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                className={`${INPUT} pl-10`}
                value={formatUsLocal(listing.notification_phone)}
                onChange={(e) => {
                  // Strip non-digits and the country code so the owner types
                  // "614 555 1234" naturally. We store E.164 on save (see
                  // listing-sanitize.ts → normalizeUsPhone).
                  const digits = e.target.value.replace(/\D+/g, '').slice(0, 10);
                  update('notification_phone', digits ? `+1${digits}` : null);
                }}
                placeholder="(614) 555-1234"
              />
            </div>
            <p className="mt-1 text-[11px] text-gray-400">USA only — the +1 country code is added automatically.</p>
          </div>
          <label className="flex items-center gap-3 self-end pb-2 sm:col-span-2">
            <input
              type="checkbox"
              checked={listing.email_notifications}
              onChange={(e) => update('email_notifications', e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm text-gray-700">Email me when I receive a new lead</span>
          </label>
        </div>
      </section>

      <div className="sticky bottom-4 flex items-center justify-end gap-3">
        <StatusBadge status={status} lastSavedAt={lastSavedAt} />
        <button
          onClick={() => save()}
          disabled={status === 'saving'}
          className="inline-flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
          style={{ backgroundColor: '#1b1b1b' }}
        >
          {status === 'saving' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {status === 'saving' ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

function StatusBadge({
  status,
  lastSavedAt,
}: {
  status: SaveStatus;
  lastSavedAt: Date | null;
}) {
  if (status === 'saving') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-900/5 px-3 py-1.5 text-xs font-medium text-gray-600">
        <Loader2 className="w-3 h-3 animate-spin" /> Saving…
      </span>
    );
  }
  if (status === 'dirty') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700">
        Unsaved changes
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700">
        <AlertCircle className="w-3 h-3" /> Save failed
      </span>
    );
  }
  if (status === 'saved' && lastSavedAt) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
        <CheckCircle2 className="w-3 h-3" /> Saved {formatRelative(lastSavedAt)}
      </span>
    );
  }
  return null;
}

/**
 * Render a stored E.164 number ("+16145551234") back into a human-friendly
 * "(614) 555-1234" so the owner sees exactly what they'll receive SMS on.
 * Also gracefully handles the intermediate "+1614555" while they're typing.
 */
function formatUsLocal(phone: string | null): string {
  if (!phone) return '';
  const digits = phone.replace(/\D+/g, '');
  const local = digits.startsWith('1') ? digits.slice(1) : digits;
  const d = local.slice(0, 10);
  if (d.length === 0) return '';
  if (d.length <= 3) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function formatRelative(d: Date): string {
  const now = Date.now();
  const diff = Math.max(0, Math.floor((now - d.getTime()) / 1000));
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}m ago`;
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
