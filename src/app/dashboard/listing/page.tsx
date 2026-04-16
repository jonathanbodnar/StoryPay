'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  Loader2, Save, CheckCircle2, Store, Globe, MapPin, Users, DollarSign,
  Image as ImageIcon, ExternalLink, Eye, EyeOff,
} from 'lucide-react';

interface Listing {
  id: string | null;
  slug: string | null;
  name: string | null;
  description: string | null;
  venue_type: string | null;
  location_full: string | null;
  location_city: string | null;
  location_state: string | null;
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
  notification_email: string | null;
  email_notifications: boolean;
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
    capacity_min: null, capacity_max: null, price_min: null, price_max: null,
    indoor_outdoor: null, features: [], cover_image_url: null, gallery_images: [],
    availability_notes: null, is_published: false, onboarding_completed: false,
    notification_email: null, email_notifications: true,
  };
}

export default function ListingPage() {
  const [listing, setListing] = useState<Listing>(emptyListing());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/listing/me', { cache: 'no-store' });
        if (!alive) return;
        if (res.ok) {
          const data = await res.json();
          if (data.listing) {
            setListing({
              ...emptyListing(),
              ...data.listing,
              features: Array.isArray(data.listing.features) ? data.listing.features : [],
              gallery_images: Array.isArray(data.listing.gallery_images) ? data.listing.gallery_images : [],
            });
          }
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  function update<K extends keyof Listing>(key: K, value: Listing[K]) {
    setListing((prev) => ({ ...prev, [key]: value }));
  }

  function toggleFeature(feat: string) {
    setListing((prev) => {
      const has = prev.features.includes(feat);
      return { ...prev, features: has ? prev.features.filter(f => f !== feat) : [...prev.features, feat] };
    });
  }

  async function save(nextPublished?: boolean) {
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...listing,
        is_published: typeof nextPublished === 'boolean' ? nextPublished : listing.is_published,
      };
      const res = await fetch('/api/listing/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to save');
      setListing({
        ...emptyListing(),
        ...data.listing,
        features: Array.isArray(data.listing.features) ? data.listing.features : [],
        gallery_images: Array.isArray(data.listing.gallery_images) ? data.listing.gallery_images : [],
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
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
            <Store className="w-6 h-6" /> Directory Listing
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
            disabled={saving}
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

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {saved && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" /> Saved
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
              onChange={(e) => update('name', e.target.value)}
              placeholder="The Maple Barn"
            />
          </div>
          <div>
            <label className={LABEL}>URL slug</label>
            <div className="flex items-center rounded-2xl border border-gray-200 bg-gray-50 focus-within:border-gray-400 focus-within:bg-white transition-colors">
              <span className="pl-3.5 pr-1 text-sm text-gray-400 whitespace-nowrap">{DIRECTORY_URL.replace(/^https?:\/\//, '')}/venue/</span>
              <input
                type="text"
                className="flex-1 bg-transparent px-1 py-2.5 text-sm text-gray-900 focus:outline-none"
                value={listing.slug ?? ''}
                onChange={(e) => update('slug', e.target.value)}
                placeholder="the-maple-barn"
              />
            </div>
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
        <h2 className={SECTION_TITLE}><MapPin className="inline w-4 h-4 -mt-0.5" /> Location</h2>
        <p className={SECTION_HINT}>Where couples will find you.</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-6">
          <div className="sm:col-span-4">
            <label className={LABEL}>Full address</label>
            <input
              type="text"
              className={INPUT}
              value={listing.location_full ?? ''}
              onChange={(e) => update('location_full', e.target.value)}
              placeholder="1234 Country Lane, Austin, TX 78701"
            />
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
      </section>

      <section className={CARD}>
        <h2 className={SECTION_TITLE}><Users className="inline w-4 h-4 -mt-0.5" /> Capacity &amp; pricing</h2>
        <p className={SECTION_HINT}>Give couples a sense of scale and budget.</p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <label className={LABEL}>Min guests</label>
            <input type="number" className={INPUT} value={listing.capacity_min ?? ''}
              onChange={(e) => update('capacity_min', e.target.value ? Number(e.target.value) : null)} />
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
          <Link
            href="/dashboard/listing/images"
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Manage photos
          </Link>
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
          <label className="flex items-center gap-3 self-end pb-2">
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

      <div className="sticky bottom-4 flex justify-end">
        <button
          onClick={() => save()}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-medium text-white shadow-lg hover:opacity-90"
          style={{ backgroundColor: '#1b1b1b' }}
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
