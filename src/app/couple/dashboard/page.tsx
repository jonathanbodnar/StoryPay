'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Heart, Loader2, Trash2 } from 'lucide-react';
import { coupleAuthedFetch, getCoupleSupabase } from '@/lib/couple-browser';

type Item = {
  saved_at: string;
  venue: {
    id: string;
    slug: string | null;
    name: string | null;
    cover_image_url: string | null;
    location_city: string | null;
    location_state: string | null;
    is_published: boolean | null;
  };
};

const DIRECTORY =
  process.env.NEXT_PUBLIC_DIRECTORY_URL || process.env.NEXT_PUBLIC_DIRECTORY_SITE_URL || 'https://storyvenue.com';

export default function CoupleDashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const supabase = getCoupleSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.replace('/couple/login');
      return;
    }
    const res = await coupleAuthedFetch('/api/couple/wishlist');
    if (res.status === 401) {
      router.replace('/couple/login');
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(typeof data.error === 'string' ? data.error : 'Failed to load');
      setLoading(false);
      return;
    }
    setItems(Array.isArray(data.items) ? data.items : []);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function removeVenue(venueId: string) {
    const res = await coupleAuthedFetch(`/api/couple/wishlist/${venueId}`, { method: 'DELETE' });
    if (res.ok) {
      setItems((prev) => prev.filter((x) => x.venue.id !== venueId));
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20 text-gray-400">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl text-gray-900">Your wish list</h1>
          <p className="mt-1 text-sm text-gray-500">Venues you&apos;ve saved from the directory.</p>
        </div>
        <Link
          href={DIRECTORY.replace(/\/$/, '')}
          className="text-sm font-medium text-gray-700 underline"
          target="_blank"
          rel="noreferrer"
        >
          Browse venues
        </Link>
      </div>

      {error && (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      {items.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-14 text-center">
          <Heart className="mx-auto mb-3 h-10 w-10 text-gray-300" />
          <p className="text-sm text-gray-600">No saved venues yet.</p>
          <p className="mt-2 text-xs text-gray-400">
            Open any published venue on the directory and tap &quot;Save to wish list&quot;.
          </p>
        </div>
      ) : (
        <ul className="mt-8 space-y-4">
          {items.map(({ venue, saved_at }) => {
            const loc = [venue.location_city, venue.location_state].filter(Boolean).join(', ');
            const href = venue.slug ? `${DIRECTORY.replace(/\/$/, '')}/venue/${venue.slug}` : '#';
            return (
              <li
                key={venue.id}
                className="flex gap-4 rounded-2xl border border-gray-200 bg-white p-4"
              >
                <div className="relative h-20 w-28 shrink-0 overflow-hidden rounded-xl bg-gray-100">
                  {venue.cover_image_url ? (
                    <Image src={venue.cover_image_url} alt="" fill className="object-cover" sizes="112px" unoptimized />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <a href={href} target="_blank" rel="noreferrer" className="font-semibold text-gray-900 hover:underline">
                    {venue.name || 'Venue'}
                  </a>
                  {loc && <p className="text-xs text-gray-500">{loc}</p>}
                  <p className="mt-1 text-[11px] text-gray-400">
                    Saved {new Date(saved_at).toLocaleDateString()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void removeVenue(venue.id)}
                  className="shrink-0 self-start rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                  aria-label="Remove from wish list"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
