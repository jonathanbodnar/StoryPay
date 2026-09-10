'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  Heart,
  MapPin,
  MessageCircle,
  CalendarDays,
  Users,
  UserCheck,
  Search,
  CheckCircle2,
  Clock,
  X,
} from 'lucide-react';
import { coupleAuthedFetch, getCoupleSupabase } from '@/lib/couple-browser';

type Venue = {
  id: string;
  slug: string | null;
  name: string | null;
  cover_image_url: string | null;
  location_city: string | null;
  location_state: string | null;
} | null;

type Wedding = {
  wedding_date: string | null;
  guest_count: number | null;
  ceremony_type: string | null;
  rehearsal_date: string | null;
  coordinator_name: string | null;
  coordinator_phone: string | null;
  space_name: string | null;
} | null;

type Link_ = {
  id: string;
  status: 'pending' | 'linked' | 'declined' | 'revoked';
  initiated_by: 'venue' | 'bride';
  created_at: string;
  linked_at: string | null;
  venue: Venue;
  wedding: Wedding;
  thread: { id: string; unread: number } | null;
};

type SearchItem = { slug: string; name: string | null; cover_image_url: string | null; location: string | null };

const DIRECTORY =
  process.env.NEXT_PUBLIC_DIRECTORY_URL || process.env.NEXT_PUBLIC_DIRECTORY_SITE_URL || 'https://storyvenue.com';

const INPUT =
  'w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-200';

function fmtDate(d: string | null): string | null {
  if (!d) return null;
  const parsed = new Date(`${d}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function CoupleWeddingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [link, setLink] = useState<Link_ | null>(null);
  const [pendingInvite, setPendingInvite] = useState<{ id: string; venue: Venue } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Connect UI
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<SearchItem | null>(null);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const supabase = getCoupleSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.replace('/couple/login');
      return;
    }
    const res = await coupleAuthedFetch('/api/couple/wedding');
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
    setLink(data.link ?? null);
    setPendingInvite(data.pendingInvite ?? null);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  // Debounced venue search
  useEffect(() => {
    if (link || pendingInvite) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await coupleAuthedFetch(`/api/couple/wedding/search?q=${encodeURIComponent(q)}`);
        const data = await res.json().catch(() => ({}));
        if (!cancelled) setResults(Array.isArray(data.items) ? data.items : []);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, link, pendingInvite]);

  async function submitRequest() {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      const res = await coupleAuthedFetch('/api/couple/wedding', {
        method: 'POST',
        body: JSON.stringify({ slug: selected.slug, message: message.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Could not send request');
        return;
      }
      setSelected(null);
      setMessage('');
      setQuery('');
      setResults([]);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function acceptInvite() {
    if (!pendingInvite) return;
    setBusy(true);
    setError('');
    try {
      const res = await coupleAuthedFetch('/api/couple/claim', {
        method: 'POST',
        body: JSON.stringify({ inviteId: pendingInvite.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Could not accept invite');
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError('');
    try {
      const res = await coupleAuthedFetch('/api/couple/wedding', { method: 'DELETE' });
      if (res.ok) await load();
    } finally {
      setBusy(false);
    }
  }

  const venueLoc = useMemo(() => {
    const v = link?.venue;
    if (!v) return null;
    return [v.location_city, v.location_state].filter(Boolean).join(', ') || null;
  }, [link]);

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
          <h1 className="font-heading text-2xl text-gray-900">My wedding</h1>
          <p className="mt-1 text-sm text-gray-500">Connect with your venue to plan and message in one place.</p>
        </div>
      </div>

      {error && (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      {/* State: venue invited this bride (unclaimed) */}
      {!link && pendingInvite && (
        <div className="mt-8 overflow-hidden rounded-2xl border border-emerald-200 bg-white">
          <div className="flex items-center gap-3 border-b border-emerald-100 bg-emerald-50 px-5 py-3">
            <Heart className="h-5 w-5 text-emerald-600" />
            <p className="text-sm font-medium text-emerald-800">
              {pendingInvite.venue?.name || 'Your venue'} invited you to connect
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-5">
            <p className="text-sm text-gray-600">
              Accept to see your wedding details and message {pendingInvite.venue?.name || 'your venue'} directly.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void acceptInvite()}
              className="rounded-2xl bg-[#1b1b1b] px-6 py-3 text-sm font-medium text-white transition-opacity hover:opacity-85 disabled:opacity-60"
            >
              {busy ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1 inline h-4 w-4" />}
              Accept invite
            </button>
          </div>
        </div>
      )}

      {/* State: linked */}
      {link && link.status === 'linked' && (
        <div className="mt-8 overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <div className="relative h-40 w-full bg-gray-100">
            {link.venue?.cover_image_url ? (
              <Image src={link.venue.cover_image_url} alt="" fill className="object-cover" sizes="768px" unoptimized />
            ) : null}
          </div>
          <div className="px-5 py-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Connected
                </div>
                <h2 className="mt-2 font-heading text-xl text-gray-900">{link.venue?.name || 'Your venue'}</h2>
                {venueLoc && (
                  <p className="mt-0.5 flex items-center gap-1 text-sm text-gray-500">
                    <MapPin className="h-3.5 w-3.5" /> {venueLoc}
                  </p>
                )}
              </div>
              <Link
                href="/couple/messages"
                className="inline-flex items-center gap-2 rounded-2xl bg-[#1b1b1b] px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-85"
              >
                <MessageCircle className="h-4 w-4" /> Message venue
                {link.thread && link.thread.unread > 0 && (
                  <span className="ml-1 rounded-full bg-white/90 px-1.5 text-[11px] font-bold text-[#1b1b1b]">
                    {link.thread.unread}
                  </span>
                )}
              </Link>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Detail icon={<CalendarDays className="h-4 w-4" />} label="Wedding date" value={fmtDate(link.wedding?.wedding_date ?? null)} />
              <Detail icon={<Users className="h-4 w-4" />} label="Guest count" value={link.wedding?.guest_count != null ? String(link.wedding.guest_count) : null} />
              <Detail icon={<Heart className="h-4 w-4" />} label="Space" value={link.wedding?.space_name ?? null} />
              <Detail icon={<UserCheck className="h-4 w-4" />} label="Coordinator" value={link.wedding?.coordinator_name ?? null} />
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-gray-100 pt-4 text-sm">
              {link.venue?.slug && (
                <a
                  href={`${DIRECTORY.replace(/\/$/, '')}/venue/${link.venue.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-gray-700 underline"
                >
                  View venue listing
                </a>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => void disconnect()}
                className="text-gray-400 underline hover:text-gray-600 disabled:opacity-60"
              >
                Disconnect
              </button>
            </div>
          </div>
        </div>
      )}

      {/* State: bride's request pending venue approval */}
      {link && link.status === 'pending' && (
        <div className="mt-8 overflow-hidden rounded-2xl border border-amber-200 bg-white">
          <div className="flex items-center gap-3 border-b border-amber-100 bg-amber-50 px-5 py-3">
            <Clock className="h-5 w-5 text-amber-600" />
            <p className="text-sm font-medium text-amber-800">Request pending</p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-5">
            <p className="text-sm text-gray-600">
              We&apos;ve sent your request to <strong>{link.venue?.name || 'your venue'}</strong>. You&apos;ll be able to
              message them here once they approve.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void disconnect()}
              className="inline-flex items-center gap-1.5 rounded-2xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-60"
            >
              <X className="h-4 w-4" /> Cancel request
            </button>
          </div>
        </div>
      )}

      {/* State: not connected — connect UI */}
      {!link && !pendingInvite && (
        <div className="mt-8">
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-6">
            <h2 className="font-heading text-lg text-gray-900">Connect with your venue</h2>
            <p className="mt-1 text-sm text-gray-500">
              Search for the venue you&apos;ve booked. We&apos;ll send them a request to connect.
            </p>

            {!selected ? (
              <>
                <div className="relative mt-4">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    className={`${INPUT} pl-9`}
                    placeholder="Search venue by name"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {searching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-gray-400" />}
                </div>

                {results.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {results.map((r) => (
                      <li key={r.slug}>
                        <button
                          type="button"
                          onClick={() => setSelected(r)}
                          className="flex w-full items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3 text-left hover:border-gray-300"
                        >
                          <div className="relative h-12 w-16 shrink-0 overflow-hidden rounded-lg bg-gray-100">
                            {r.cover_image_url ? (
                              <Image src={r.cover_image_url} alt="" fill className="object-cover" sizes="64px" unoptimized />
                            ) : null}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-gray-900">{r.name || 'Venue'}</p>
                            {r.location && <p className="truncate text-xs text-gray-500">{r.location}</p>}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {query.trim().length >= 2 && !searching && results.length === 0 && (
                  <p className="mt-3 text-sm text-gray-400">No venues found. Try a different name.</p>
                )}
              </>
            ) : (
              <div className="mt-4 rounded-2xl border border-gray-200 p-4">
                <div className="flex items-center gap-3">
                  <div className="relative h-12 w-16 shrink-0 overflow-hidden rounded-lg bg-gray-100">
                    {selected.cover_image_url ? (
                      <Image src={selected.cover_image_url} alt="" fill className="object-cover" sizes="64px" unoptimized />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-gray-900">{selected.name || 'Venue'}</p>
                    {selected.location && <p className="truncate text-xs text-gray-500">{selected.location}</p>}
                  </div>
                  <button type="button" onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <textarea
                  className={`${INPUT} mt-3 min-h-[80px]`}
                  placeholder="Add a note for the venue (optional)"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void submitRequest()}
                  className="mt-3 w-full rounded-2xl bg-[#1b1b1b] px-6 py-3 text-sm font-medium text-white transition-opacity hover:opacity-85 disabled:opacity-60"
                >
                  {busy ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : null} Send connection request
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | null }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-gray-100 bg-gray-50/50 px-3 py-2.5">
      <span className="mt-0.5 text-gray-400">{icon}</span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
        <p className="truncate text-sm text-gray-900">{value || <span className="text-gray-400">Not set</span>}</p>
      </div>
    </div>
  );
}
