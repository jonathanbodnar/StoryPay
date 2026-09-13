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
  Armchair,
  Images,
  ListChecks,
  Contact,
  Wallet,
  Globe,
  ChevronRight,
  Mail,
  Phone,
  UserCircle2,
  Eye,
  Pencil,
  Trash2,
  Plus,
} from 'lucide-react';
import { coupleAuthedFetch, getCoupleSupabase } from '@/lib/couple-browser';

type Venue = {
  id: string;
  slug: string | null;
  name: string | null;
  cover_image_url: string | null;
  location_city: string | null;
  location_state: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  primary_contact: string | null;
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

type Shared = {
  wedding_date: boolean;
  guest_count: boolean;
  space: boolean;
  coordinator: boolean;
};

type GuestSummary = {
  total: number;
  attending: number;
  declined: number;
  pending: number;
  headcount: number;
} | null;

type Link_ = {
  id: string;
  status: 'pending' | 'linked' | 'declined' | 'revoked';
  initiated_by: 'venue' | 'bride';
  created_at: string;
  linked_at: string | null;
  venue: Venue;
  wedding: Wedding;
  shared: Shared | null;
  guests: GuestSummary;
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
  const [access, setAccess] = useState<'owner' | 'edit' | 'view' | null>(null);
  const [pendingInvite, setPendingInvite] = useState<{ id: string; venue: Venue } | null>(null);
  const [coupleWeddingDate, setCoupleWeddingDate] = useState<string | null>(null);
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
    setAccess(data.access === 'owner' || data.access === 'edit' || data.access === 'view' ? data.access : null);
    setPendingInvite(data.pendingInvite ?? null);
    setCoupleWeddingDate(typeof data.coupleWeddingDate === 'string' ? data.coupleWeddingDate : null);
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

  // Countdown always shows whenever a wedding date is saved — the couple's own
  // date is source of truth (falls back to the venue-shared date), so venue
  // visibility toggles never hide it, and it re-renders live if the date changes.
  const countdownDate = coupleWeddingDate || link?.wedding?.wedding_date || null;

  const isOwner = access === 'owner';
  const isCollaborator = access === 'edit' || access === 'view';
  const isReadOnly = access === 'view';

  if (loading) {
    return (
      <div className="flex justify-center py-20 text-gray-400">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl text-gray-900">Wedding Planner</h1>
          <p className="mt-1 text-sm text-gray-500">Everything you need to plan your wedding in one place.</p>
        </div>
        {countdownDate && <WeddingCountdown date={countdownDate} />}
      </div>

      {error && (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      {/* Collaborator context banner: this person was invited into someone's planner. */}
      {isCollaborator && (
        <div className="mt-6 flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-600">
          {isReadOnly ? <Eye className="h-4 w-4 shrink-0 text-gray-400" /> : <Pencil className="h-4 w-4 shrink-0 text-gray-400" />}
          <span>
            You have <strong className="text-gray-900">{isReadOnly ? 'view-only' : 'edit'}</strong> access to this Wedding
            Planner. The couple&apos;s budget stays private to them.
          </span>
        </div>
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

            {(link.venue?.address || link.venue?.phone || link.venue?.email || link.venue?.primary_contact) && (
              <div className="mt-4 border-t border-gray-100 pt-4">
                <ul className="space-y-2.5">
                  {link.venue?.address && (
                    <li className="flex items-center gap-3 text-sm text-gray-600">
                      <MapPin className="h-4 w-4 shrink-0 text-gray-400" />
                      <span>{link.venue.address}</span>
                    </li>
                  )}
                  {link.venue?.primary_contact && (
                    <li className="flex items-center gap-3 text-sm text-gray-600">
                      <UserCircle2 className="h-4 w-4 shrink-0 text-gray-400" />
                      <span>{link.venue.primary_contact}</span>
                    </li>
                  )}
                  {link.venue?.phone && (
                    <li className="flex items-center gap-3 text-sm text-gray-600">
                      <Phone className="h-4 w-4 shrink-0 text-gray-400" />
                      <a
                        href={`tel:${link.venue.phone.replace(/[^\d+]/g, '')}`}
                        className="transition-colors hover:text-gray-900 hover:underline"
                      >
                        {link.venue.phone}
                      </a>
                    </li>
                  )}
                  {link.venue?.email && (
                    <li className="flex items-center gap-3 text-sm text-gray-600">
                      <Mail className="h-4 w-4 shrink-0 text-gray-400" />
                      <a
                        href={`mailto:${link.venue.email}`}
                        className="transition-colors hover:text-gray-900 hover:underline"
                      >
                        {link.venue.email}
                      </a>
                    </li>
                  )}
                </ul>
              </div>
            )}

            {(() => {
              const shared = link.shared;
              const show = {
                wedding_date: shared?.wedding_date !== false,
                guest_count: shared?.guest_count !== false,
                space: shared?.space !== false,
                coordinator: shared?.coordinator !== false,
              };
              const anyShared = show.wedding_date || show.guest_count || show.space || show.coordinator;
              if (!anyShared) return null;
              return (
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {show.wedding_date && (
                    <Detail icon={<CalendarDays className="h-4 w-4" />} label="Wedding date" value={fmtDate(link.wedding?.wedding_date ?? null)} />
                  )}
                  {show.guest_count && (
                    <Detail icon={<Users className="h-4 w-4" />} label="Guest count" value={link.wedding?.guest_count != null ? String(link.wedding.guest_count) : null} />
                  )}
                  {show.space && (
                    <Detail icon={<Heart className="h-4 w-4" />} label="Space" value={link.wedding?.space_name ?? null} />
                  )}
                  {show.coordinator && (
                    <Detail icon={<UserCheck className="h-4 w-4" />} label="Coordinator" value={link.wedding?.coordinator_name ?? null} />
                  )}
                </div>
              );
            })()}

            {/* Guest list summary — bride owns and manages it */}
            <Link
              href="/couple/guests"
              className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50/50 px-4 py-3 transition-colors hover:border-gray-200 hover:bg-gray-50"
            >
              <div className="flex items-center gap-2.5">
                <Users className="h-4 w-4 text-gray-400" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Guest list & RSVPs</p>
                  <p className="text-xs text-gray-500">
                    {link.guests && link.guests.total > 0
                      ? `${link.guests.attending} attending · ${link.guests.pending} awaiting · ${link.guests.total} invited`
                      : 'Add your guests, track RSVPs and meal choices'}
                  </p>
                </div>
              </div>
              <span className="text-sm font-medium text-gray-700 underline">Manage</span>
            </Link>

            <WeddingPlannerTools unread={link.thread?.unread ?? 0} showBudget={isOwner} />

            {/* Owner-only: manage the up-to-5 people invited into the planner. */}
            {isOwner && <CollaboratorsCard />}

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
              {isOwner && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void disconnect()}
                  className="text-gray-400 underline hover:text-gray-600 disabled:opacity-60"
                >
                  Disconnect
                </button>
              )}
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

const HUB_TOOLS: { href: string; label: string; desc: string; icon: React.ReactNode }[] = [
  { href: '/couple/guests', label: 'Guests & RSVPs', desc: 'Track invites, meals & replies', icon: <Users className="h-5 w-5" /> },
  { href: '/couple/seating', label: 'Seating', desc: 'Arrange tables & assign guests', icon: <Armchair className="h-5 w-5" /> },
  { href: '/couple/timeline', label: 'Day-of timeline', desc: 'Plan your day minute by minute', icon: <Clock className="h-5 w-5" /> },
  { href: '/couple/checklist', label: 'Checklist', desc: 'Every to-do with a countdown', icon: <ListChecks className="h-5 w-5" /> },
  { href: '/couple/budget', label: 'Budget', desc: 'Track spending — private to you', icon: <Wallet className="h-5 w-5" /> },
  { href: '/couple/vendors', label: 'Vendors', desc: 'All your day-of contacts', icon: <Contact className="h-5 w-5" /> },
  { href: '/couple/inspiration', label: 'Inspiration', desc: 'Your style & mood board', icon: <Images className="h-5 w-5" /> },
  { href: '/couple/site', label: 'Wedding website', desc: 'Your public wedding page', icon: <Globe className="h-5 w-5" /> },
];

function WeddingPlannerTools({ unread, showBudget }: { unread: number; showBudget: boolean }) {
  // Budget is private to the owning couple — hide it entirely for collaborators.
  const tools = showBudget ? HUB_TOOLS : HUB_TOOLS.filter((t) => t.href !== '/couple/budget');
  return (
    <div className="mt-6">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Plan your wedding</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {tools.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="group flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4 transition-colors hover:border-gray-300 hover:bg-gray-50"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#1b1b1b] text-white">
              {t.icon}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900">{t.label}</p>
              <p className="truncate text-xs text-gray-500">{t.desc}</p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-gray-300 transition-transform group-hover:translate-x-0.5" />
          </Link>
        ))}
        <Link
          href="/couple/messages"
          className="group flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4 transition-colors hover:border-gray-300 hover:bg-gray-50"
        >
          <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#1b1b1b] text-white">
            <MessageCircle className="h-5 w-5" />
            {unread > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                {unread}
              </span>
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900">Messages</p>
            <p className="truncate text-xs text-gray-500">Chat directly with your venue</p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-gray-300 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </div>
  );
}

/**
 * Live wedding countdown — days / hrs / min / sec cells, ticking every second.
 * Mirrors the couple's public wedding-website countdown (weddingdirectory
 * minisite/Countdown.tsx) so the look is consistent across both surfaces.
 */
function WeddingCountdown({ date }: { date: string }) {
  const target = useMemo(() => new Date(`${date}T00:00:00`).getTime(), [date]);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (Number.isNaN(target)) return null;

  const diff = target - now;
  if (diff <= 0) {
    return (
      <div className="shrink-0 rounded-2xl border border-gray-200 bg-white px-5 py-3 text-center shadow-sm">
        <p className="font-heading text-base text-[#1b1b1b]">You&apos;re married! 🤍</p>
        <p className="mt-0.5 text-[11px] text-gray-400">{fmtDate(date)}</p>
      </div>
    );
  }

  const cells: [number, string][] = [
    [Math.floor(diff / 86400000), 'days'],
    [Math.floor((diff % 86400000) / 3600000), 'hrs'],
    [Math.floor((diff % 3600000) / 60000), 'min'],
    [Math.floor((diff % 60000) / 1000), 'sec'],
  ];

  return (
    <div className="shrink-0">
      <div className="flex items-stretch gap-2">
        {cells.map(([value, label]) => (
          <div
            key={label}
            className="flex w-[62px] flex-col items-center rounded-2xl border border-gray-200 bg-white px-2 py-2.5 shadow-sm"
          >
            <span className="text-2xl font-semibold tabular-nums text-[#1b1b1b]">{String(value).padStart(2, '0')}</span>
            <span className="mt-0.5 text-[10px] uppercase tracking-wide text-gray-400">{label}</span>
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-right text-[11px] text-gray-400">{fmtDate(date)}</p>
    </div>
  );
}

type Collaborator = {
  id: string;
  invited_by: 'couple' | 'venue';
  role: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  access_level: 'view' | 'edit';
  status: 'invited' | 'active' | 'revoked';
  created_at: string;
};

/**
 * Owner-only card to manage the up-to-5 people invited into the Wedding Planner.
 * Each invitee gets their own account and view/edit access to every tool except
 * the private budget. A venue-assigned coordinator (invited_by='venue') also
 * shows here as read-only info.
 */
function CollaboratorsCard() {
  const [rows, setRows] = useState<Collaborator[]>([]);
  const [loading, setLoading] = useState(true);
  const [max, setMax] = useState(5);
  const [remaining, setRemaining] = useState(5);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [level, setLevel] = useState<'view' | 'edit'>('view');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [flash, setFlash] = useState('');

  const load = useCallback(async () => {
    const res = await coupleAuthedFetch('/api/couple/collaborators');
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setRows(Array.isArray(data.collaborators) ? data.collaborators : []);
      if (typeof data.max === 'number') setMax(data.max);
      if (typeof data.remaining === 'number') setRemaining(data.remaining);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setFlash('');
    if (!name.trim()) { setErr('A name is required.'); return; }
    if (!email.trim()) { setErr('An email is required.'); return; }
    if (!phone.trim()) { setErr('A phone number is required.'); return; }
    setBusy(true);
    try {
      const res = await coupleAuthedFetch('/api/couple/collaborators', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), email: email.trim(), phone: phone.trim(), access_level: level }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(typeof data.error === 'string' ? data.error : 'Could not send the invite.');
        return;
      }
      setFlash('Invite sent.');
      setName('');
      setEmail('');
      setPhone('');
      setLevel('view');
      setOpen(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function changeLevel(id: string, next: 'view' | 'edit') {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, access_level: next } : r)));
    await coupleAuthedFetch('/api/couple/collaborators', {
      method: 'PATCH',
      body: JSON.stringify({ id, access_level: next }),
    });
    await load();
  }

  async function remove(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
    await coupleAuthedFetch(`/api/couple/collaborators?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    await load();
  }

  const coupleInvited = rows.filter((r) => r.invited_by === 'couple');
  const coordinator = rows.find((r) => r.invited_by === 'venue');

  return (
    <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-heading text-base text-gray-900">Wedding Planner access</h3>
          <p className="mt-0.5 text-sm text-gray-500">
            Invite up to {max} people to help plan. They get view or edit access to everything except your budget.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          disabled={remaining <= 0}
          className="inline-flex items-center gap-1.5 rounded-2xl bg-[#1b1b1b] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-85 disabled:opacity-40"
        >
          <Plus className="h-4 w-4" /> Invite
        </button>
      </div>

      {flash && (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{flash}</div>
      )}

      {open && (
        <form onSubmit={invite} className="mt-4 grid gap-3 rounded-xl border border-gray-200 bg-gray-50/60 p-4 sm:grid-cols-2">
          <input
            className={INPUT}
            placeholder="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className={INPUT}
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className={INPUT}
            type="tel"
            placeholder="Phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <div className="flex items-center gap-1.5 rounded-2xl border border-gray-200 bg-white p-1">
            {(['view', 'edit'] as const).map((lv) => (
              <button
                key={lv}
                type="button"
                onClick={() => setLevel(lv)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium transition-colors ${
                  level === lv ? 'bg-[#1b1b1b] text-white' : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                {lv === 'view' ? <Eye className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                {lv === 'view' ? 'View only' : 'Can edit'}
              </button>
            ))}
          </div>
          {err && <p className="text-sm text-red-600 sm:col-span-2">{err}</p>}
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-2xl bg-[#1b1b1b] px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-85 disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Send invite
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : coupleInvited.length === 0 && !coordinator ? (
        <p className="mt-4 text-sm text-gray-400">No one invited yet. Add family, your wedding party, or a planner to help.</p>
      ) : (
        <ul className="mt-4 divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-100">
          {coupleInvited.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 bg-white px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">{c.name || c.email || 'Invitee'}</p>
                <p className="truncate text-xs text-gray-500">
                  {[c.email, c.phone].filter(Boolean).join(' · ')}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                    c.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                  }`}
                >
                  {c.status === 'active' ? <CheckCircle2 className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                  {c.status === 'active' ? 'Active' : 'Invited'}
                </span>
                <div className="flex items-center gap-0.5 rounded-full border border-gray-200 p-0.5">
                  {(['view', 'edit'] as const).map((lv) => (
                    <button
                      key={lv}
                      type="button"
                      onClick={() => void changeLevel(c.id, lv)}
                      title={lv === 'view' ? 'View only' : 'Can edit'}
                      className={`rounded-full px-2 py-1 text-[11px] font-medium transition-colors ${
                        c.access_level === lv ? 'bg-[#1b1b1b] text-white' : 'text-gray-500 hover:bg-gray-100'
                      }`}
                    >
                      {lv === 'view' ? 'View' : 'Edit'}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => void remove(c.id)}
                  title="Remove"
                  className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
          {coordinator && (
            <li className="flex flex-wrap items-center justify-between gap-3 bg-gray-50/60 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">
                  {coordinator.name || coordinator.email || 'Coordinator'}
                  <span className="ml-1.5 rounded-full bg-gray-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600">
                    Coordinator
                  </span>
                </p>
                <p className="truncate text-xs text-gray-500">Assigned by your venue · edit access</p>
              </div>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                  coordinator.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                }`}
              >
                {coordinator.status === 'active' ? <CheckCircle2 className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                {coordinator.status === 'active' ? 'Active' : 'Invited'}
              </span>
            </li>
          )}
        </ul>
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
