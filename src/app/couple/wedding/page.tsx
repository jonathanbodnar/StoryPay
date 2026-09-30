'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  CreditCard,
  Globe,
  ChevronRight,
  Mail,
  Send,
  Phone,
  UserCircle2,
  Eye,
  Pencil,
  Trash2,
  Plus,
  Circle,
  Lock,
  ChevronDown,
  Building2,
  MailCheck,
  MessageSquareHeart,
  Camera,
} from 'lucide-react';
import { coupleAuthedFetch, getCoupleSupabase } from '@/lib/couple-browser';
import { PLANNER_SETUP_ITEMS, type PlannerSetupKey, type PlannerSetupState } from '@/lib/couple-planner-setup';

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

/** /api/couple/home: names, date and cover photo, the setup checklist, and the dashboard metrics. */
type HomeData = {
  /** coverUrl is their wedding website's cover photo: one image themes both. */
  couple: { firstName: string | null; partnerFirstName: string | null; weddingDate: string | null; coverUrl: string | null };
  setup: { items: PlannerSetupState[]; doneCount: number; total: number } | null;
  metrics: HomeMetrics;
};

type HomeMetrics = {
  website: { status: 'published' | 'draft' | 'none'; slug: string | null; views: number; viewsThisWeek: number; guestbook: number } | null;
  guests: { total: number; attending: number; declined: number; awaiting: number; replied: number; headcount: number };
  invitesSent: number | null;
  todos: { done: number; total: number; next: { title: string; dueDate: string | null } | null };
  budget: { target: number; estimated: number; actual: number } | null;
  vendors: number;
  inspiration: number;
  /** What they've paid their venue (the couple only, once the venue is connected). */
  payments?: { paidCents: number; totalCents: number; balanceCents: number; next: { amountCents: number; date: string | null } | null; url: string } | null;
};

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
  const [home, setHome] = useState<HomeData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Connect UI
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<SearchItem | null>(null);
  const [message, setMessage] = useState('');
  const [showVenueSearch, setShowVenueSearch] = useState(false);
  // "My venue isn't here": a suggestion the StoryVenue team can follow up on.
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestLocation, setSuggestLocation] = useState('');
  const [suggestState, setSuggestState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function sendVenueSuggestion() {
    const venueName = query.trim();
    if (venueName.length < 2) return;
    setSuggestState('sending');
    try {
      const res = await coupleAuthedFetch('/api/couple/venue-suggestion', {
        method: 'POST',
        body: JSON.stringify({ venueName, location: suggestLocation.trim() || undefined }),
      });
      setSuggestState(res.ok ? 'sent' : 'error');
    } catch {
      setSuggestState('error');
    }
  }

  const load = useCallback(async () => {
    const supabase = getCoupleSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.replace('/couple/login');
      return;
    }
    const [res, homeRes] = await Promise.all([
      coupleAuthedFetch('/api/couple/wedding'),
      coupleAuthedFetch('/api/couple/home').catch(() => null),
    ]);
    if (res.status === 401) {
      router.replace('/couple/login');
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (homeRes?.ok) setHome((await homeRes.json().catch(() => null)) as HomeData | null);
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

  // The dashboard cover is the wedding website's cover (couple_sites.cover_url),
  // so changing it here changes the website too: one image themes both.
  const [coverBusy, setCoverBusy] = useState(false);
  async function saveCover(url: string | null) {
    const res = await coupleAuthedFetch('/api/couple/site', { method: 'PUT', body: JSON.stringify({ cover_url: url }) });
    if (!res.ok) throw new Error('Could not save your cover photo. Please try again.');
    setHome((h) => (h ? { ...h, couple: { ...h.couple, coverUrl: url } } : h));
  }
  async function uploadCover(file: File) {
    setError('');
    if (!file.type.startsWith('image/')) return setError('Please choose a photo (JPG, PNG or WebP).');
    if (file.size > 10 * 1024 * 1024) return setError('That photo is over 10 MB. Please choose a smaller one.');
    setCoverBusy(true);
    try {
      const signRes = await coupleAuthedFetch('/api/couple/site/image', {
        method: 'POST',
        body: JSON.stringify({ fileName: file.name, contentType: file.type, size: file.size }),
      });
      const sign = await signRes.json().catch(() => ({}));
      if (!signRes.ok) throw new Error(typeof sign.error === 'string' ? sign.error : 'Upload failed');
      const put = await fetch(sign.signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!put.ok) throw new Error('Upload failed. Please try again.');
      await saveCover(sign.publicUrl as string);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed. Please try again.');
    } finally {
      setCoverBusy(false);
    }
  }
  async function removeCover() {
    setError('');
    setCoverBusy(true);
    try {
      await saveCover(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove your cover photo.');
    } finally {
      setCoverBusy(false);
    }
  }

  async function toggleSetup(key: PlannerSetupKey, done: boolean) {
    const before = home;
    setHome((h) => {
      if (!h?.setup) return h;
      const items = h.setup.items.map((i) => (i.key === key ? { ...i, done } : i));
      return { ...h, setup: { ...h.setup, items, doneCount: items.filter((i) => i.done).length } };
    });
    const res = await coupleAuthedFetch('/api/couple/home', {
      method: 'PATCH',
      body: JSON.stringify({ key, done }),
    }).catch(() => null);
    if (!res?.ok) {
      setHome(before);
      setError('Could not save your checklist. Please try again.');
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
  const isLinked = link?.status === 'linked';
  // The couple whose planner this is (the owner, or a couple with no venue yet).
  const isPlannerCouple = access === 'owner' || access === null;

  if (loading) {
    return (
      <div className="flex justify-center py-20 text-gray-400">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      {/* Collaborator context banner: this person was invited into someone's planner. */}
      {isCollaborator && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-600">
          {isReadOnly ? <Eye className="h-4 w-4 shrink-0 text-gray-400" /> : <Pencil className="h-4 w-4 shrink-0 text-gray-400" />}
          <span>
            You have <strong className="text-gray-900">{isReadOnly ? 'view-only' : 'edit'}</strong>{' '}
            access to this Wedding Planner. The couple&apos;s budget stays private to them.
          </span>
        </div>
      )}

      <DashboardHero
        greetName={isPlannerCouple ? home?.couple.firstName ?? null : null}
        firstName={home?.couple.firstName ?? null}
        partnerFirstName={home?.couple.partnerFirstName ?? null}
        date={countdownDate}
        venueName={isLinked ? link?.venue?.name ?? null : null}
        canEditDate={isPlannerCouple}
        coverUrl={home?.couple.coverUrl ?? null}
        cover={isPlannerCouple ? { busy: coverBusy, onUpload: (f) => void uploadCover(f), onRemove: () => void removeCover() } : null}
      />

      {/* State: venue invited this bride (unclaimed) */}
      {!link && pendingInvite && (
        <div className="mt-6 overflow-hidden rounded-2xl border border-emerald-200 bg-white">
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

      {/* The best-practice first steps, ticked off as the couple goes. */}
      {isPlannerCouple && home?.setup && (
        <SetupChecklist setup={home.setup} onToggle={(key, done) => void toggleSetup(key, done)} />
      )}

      {home?.metrics && <MetricsGrid metrics={home.metrics} />}

      <WeddingPlannerTools unread={link?.thread?.unread ?? 0} showBudget={isPlannerCouple} venueConnected={isLinked} />

      {/* Your venue: connected, waiting on approval, or an optional card to find it. */}
      {(link || (isPlannerCouple && !pendingInvite)) && (
      <div id="venue" className="mt-8 scroll-mt-24">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Your venue</h3>
      {/* State: linked */}
      {link && link.status === 'linked' && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <div className="relative h-32 w-full bg-gray-100">
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
                      <a
                        href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(link.venue.address)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="transition-colors hover:text-gray-900 hover:underline"
                      >
                        {link.venue.address}
                      </a>
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
        <div className="mt-4 overflow-hidden rounded-2xl border border-amber-200 bg-white">
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

      {!link && !pendingInvite && isPlannerCouple && (
        <div className="mt-4 rounded-2xl border border-dashed border-gray-300 bg-white p-5">
          <div className="flex flex-wrap items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-600">
              <Building2 className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900">Is your venue on StoryVenue?</p>
              <p className="mt-0.5 text-xs text-gray-500">
                Optional. Connect to message your venue here and share your wedding details. Your planner works either way.
              </p>
            </div>
            {!showVenueSearch && (
              <button
                type="button"
                onClick={() => setShowVenueSearch(true)}
                className="shrink-0 rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                Find my venue
              </button>
            )}
          </div>
          {showVenueSearch && (
            <div className="mt-2">
                {!selected ? (
                  <>
                    <div className="relative mt-4">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                      <input
                        className={`${INPUT} pl-9`}
                        placeholder="Search venue by name"
                        value={query}
                        onChange={(e) => {
                          setQuery(e.target.value);
                          if (suggestState !== 'idle') setSuggestState('idle');
                        }}
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
                      suggestState === 'sent' ? (
                        <p className="mt-3 text-sm text-gray-600">
                          Thanks! We&apos;ll invite {query.trim()} to StoryVenue. Your planner works either way.
                        </p>
                      ) : (
                        <div className="mt-3 space-y-2">
                          <p className="text-sm text-gray-500">
                            No venues found. Try a different name, or{' '}
                            {!suggestOpen ? (
                              <button
                                type="button"
                                onClick={() => setSuggestOpen(true)}
                                className="font-semibold text-gray-800 underline"
                              >
                                tell us your venue
                              </button>
                            ) : (
                              'tell us your venue'
                            )}
                            {' '}and we&apos;ll invite them.
                          </p>
                          {suggestOpen && (
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                id="venue-suggest-location"
                                className={`${INPUT} min-w-0 flex-1`}
                                placeholder={`City and state for ${query.trim()} (optional)`}
                                value={suggestLocation}
                                onChange={(e) => setSuggestLocation(e.target.value)}
                              />
                              <button
                                type="button"
                                onClick={() => void sendVenueSuggestion()}
                                disabled={suggestState === 'sending'}
                                className="shrink-0 rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                              >
                                {suggestState === 'sending' ? 'Sending…' : 'Send'}
                              </button>
                            </div>
                          )}
                          {suggestState === 'error' && (
                            <p className="text-xs text-red-600">That didn&apos;t send. Please try again.</p>
                          )}
                        </div>
                      )
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
          )}
        </div>
      )}
      </div>
      )}

      {/* Owner-only: manage the up-to-5 people invited into the planner. */}
      {isOwner && (
        <div id="collaborators" className="scroll-mt-24">
          <CollaboratorsCard />
        </div>
      )}
    </div>
  );
}

const HUB_TOOLS: { href: string; label: string; desc: string; icon: React.ReactNode; ownerOnly?: boolean }[] = [
  { href: '/couple/guests', label: 'Guests & RSVPs', desc: 'Track invites, meals & replies', icon: <Users className="h-5 w-5" /> },
  { href: '/couple/seating', label: 'Seating', desc: 'Arrange tables & assign guests', icon: <Armchair className="h-5 w-5" /> },
  { href: '/couple/timeline', label: 'Day-of timeline', desc: 'Plan your day minute by minute', icon: <Clock className="h-5 w-5" /> },
  { href: '/couple/checklist', label: 'Checklist', desc: 'Every to-do with a countdown', icon: <ListChecks className="h-5 w-5" /> },
  { href: '/couple/budget', label: 'Budget', desc: 'Track spending — private to you', icon: <Wallet className="h-5 w-5" />, ownerOnly: true },
  { href: '/couple/vendors', label: 'Vendors', desc: 'All your day-of contacts', icon: <Contact className="h-5 w-5" /> },
  { href: '/couple/inspiration', label: 'Inspiration', desc: 'Your style & mood board', icon: <Images className="h-5 w-5" /> },
  { href: '/couple/site', label: 'Wedding website', desc: 'Your public wedding page', icon: <Globe className="h-5 w-5" /> },
  { href: '/couple/invite-guests', label: 'Invite to website', desc: 'Email guests your wedding site', icon: <Send className="h-5 w-5" />, ownerOnly: true },
];

function WeddingPlannerTools({ unread, showBudget, venueConnected }: { unread: number; showBudget: boolean; venueConnected: boolean }) {
  // Budget + website invites are private to the owning couple — hide owner-only
  // tools entirely for collaborators.
  const tools = showBudget ? HUB_TOOLS : HUB_TOOLS.filter((t) => !t.ownerOnly);
  return (
    <div className="mt-8">
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
            <p className="truncate text-xs text-gray-500">
              {venueConnected ? 'Chat directly with your venue' : 'Connect your venue to message them'}
            </p>
          </div>
          {!venueConnected ? (
            <Lock className="h-4 w-4 shrink-0 text-gray-300" aria-label="Needs a connected venue" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-gray-300 transition-transform group-hover:translate-x-0.5" />
          )}
        </Link>
      </div>
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
                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
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
                  className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
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

/**
 * The top of the dashboard: the welcome, and a live countdown once the wedding
 * date is set (or a nudge to add it). The background is the couple's cover
 * photo, the same image as their wedding website's cover, so one upload themes
 * both. With no cover yet it's a clean card that invites them to add one.
 */
function DashboardHero({
  greetName,
  firstName,
  partnerFirstName,
  date,
  venueName,
  canEditDate,
  coverUrl,
  cover,
}: {
  /** Who's signed in, when it's the couple (a helper gets a neutral welcome). */
  greetName: string | null;
  firstName: string | null;
  partnerFirstName: string | null;
  date: string | null;
  venueName: string | null;
  canEditDate: boolean;
  coverUrl: string | null;
  /** Upload/remove controls, for the couple only. */
  cover: { busy: boolean; onUpload: (file: File) => void; onRemove: () => void } | null;
}) {
  const target = useMemo(() => (date ? new Date(`${date}T00:00:00`).getTime() : NaN), [date]);
  const hasDate = !Number.isNaN(target);
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!hasDate) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [hasDate]);
  const fileRef = useRef<HTMLInputElement>(null);

  const diff = hasDate ? target - now : 0;
  const isToday = hasDate && diff <= 0 && diff > -86_400_000;
  const isPast = hasDate && diff <= -86_400_000;
  const names = [firstName, partnerFirstName].filter(Boolean).join(' & ');
  const dateLine = [fmtDate(date), venueName].filter(Boolean).join(' · ');
  const cells: [number, string][] = [
    [Math.floor(diff / 86_400_000), 'days'],
    [Math.floor((diff % 86_400_000) / 3_600_000), 'hrs'],
    [Math.floor((diff % 3_600_000) / 60_000), 'min'],
    [Math.floor((diff % 60_000) / 1000), 'sec'],
  ];
  const onPhoto = Boolean(coverUrl);
  const tile = onPhoto ? 'bg-white/15 ring-1 ring-white/25 backdrop-blur-md' : 'bg-white ring-1 ring-gray-200';
  const muted = onPhoto ? 'text-white/85 drop-shadow' : 'text-gray-500';
  const heading = `mt-1.5 font-heading text-3xl leading-tight sm:text-4xl ${onPhoto ? 'drop-shadow' : 'text-gray-900'}`;

  const filePicker = cover && (
    <input
      ref={fileRef}
      type="file"
      accept="image/jpeg,image/png,image/webp,image/avif"
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) cover.onUpload(f);
        e.target.value = '';
      }}
    />
  );

  return (
    <div
      className={`group relative overflow-hidden rounded-3xl ${
        onPhoto ? 'bg-[#1b1b1b] text-white' : 'border border-gray-200 bg-gradient-to-br from-[#fbf8f4] to-[#f3ede5] text-gray-900'
      }`}
    >
      {filePicker}
      {onPhoto && (
        <>
          <Image
            src={coverUrl!}
            alt=""
            fill
            priority
            sizes="(min-width: 1280px) 1152px, 100vw"
            className="object-cover object-[50%_40%]"
          />
          {/* Keeps the text readable: a bottom fade on phones, a left fade on wider screens. */}
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent sm:bg-gradient-to-r sm:from-black/65 sm:via-black/20 sm:to-transparent"
          />
          {cover && (
            <div className="absolute right-3 top-3 flex gap-2 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
              <button
                type="button"
                disabled={cover.busy}
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-black/40 px-3 py-1.5 text-xs font-medium text-white ring-1 ring-white/25 backdrop-blur-md transition-colors hover:bg-black/55 disabled:opacity-60"
              >
                {cover.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />} Change photo
              </button>
              <button
                type="button"
                disabled={cover.busy}
                onClick={cover.onRemove}
                className="rounded-xl bg-black/40 px-3 py-1.5 text-xs font-medium text-white ring-1 ring-white/25 backdrop-blur-md transition-colors hover:bg-black/55 disabled:opacity-60"
              >
                Remove
              </button>
            </div>
          )}
        </>
      )}

      <div
        className={`relative flex flex-col gap-6 px-6 py-7 sm:px-9 sm:py-9 ${
          onPhoto ? 'min-h-[420px] justify-end pt-24 sm:min-h-[340px] sm:max-w-[27rem] sm:justify-center' : 'sm:flex-row sm:items-center sm:justify-between'
        }`}
      >
        <div>
          <p className={`text-sm ${muted}`}>{greetName ? `Welcome back, ${greetName}` : 'Welcome to the Wedding Planner'}</p>
          {hasDate && !isToday && !isPast ? (
            <>
              <p className={heading}>{names || 'Your wedding day'}</p>
              {dateLine && <p className={`mt-1 text-sm ${muted}`}>{dateLine}</p>}
              <div className="mt-5 flex gap-2" aria-label="Countdown to your wedding">
                {cells.map(([value, label]) => (
                  <div key={label} className={`w-16 rounded-2xl py-2.5 text-center ${tile}`}>
                    <p className="text-2xl font-semibold leading-none tabular-nums">{String(Math.max(0, value)).padStart(2, '0')}</p>
                    <p className={`mt-1 text-[10px] uppercase tracking-wider ${onPhoto ? 'text-white/75' : 'text-gray-400'}`}>{label}</p>
                  </div>
                ))}
              </div>
              <p className={`mt-2 text-xs ${onPhoto ? 'text-white/75' : 'text-gray-400'}`}>until you say “I do”</p>
            </>
          ) : isToday || isPast ? (
            <>
              <p className={heading}>{isToday ? 'Today’s the day! 🤍' : 'You’re married! 🤍'}</p>
              {dateLine && <p className={`mt-1 text-sm ${muted}`}>{dateLine}</p>}
            </>
          ) : (
            <>
              <p className={heading}>Let&apos;s plan your wedding</p>
              {canEditDate && (
                <Link
                  href="/couple/profile"
                  className={`mt-5 inline-flex w-fit items-center gap-1.5 rounded-2xl px-4 py-2.5 text-sm font-medium transition-opacity hover:opacity-90 ${
                    onPhoto ? 'bg-white text-[#1b1b1b]' : 'bg-[#1b1b1b] text-white'
                  }`}
                >
                  <CalendarDays className="h-4 w-4" /> Add your wedding date
                </Link>
              )}
            </>
          )}
        </div>

        {/* No cover yet: invite one (it becomes the website's cover too). */}
        {!onPhoto && cover && (
          <button
            type="button"
            disabled={cover.busy}
            onClick={() => fileRef.current?.click()}
            className="flex w-full shrink-0 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gray-300 bg-white/60 px-6 py-6 text-center transition-colors hover:border-gray-400 hover:bg-white disabled:opacity-60 sm:w-72"
          >
            {cover.busy ? <Loader2 className="h-6 w-6 animate-spin text-gray-400" /> : <Camera className="h-6 w-6 text-gray-400" />}
            <span className="text-sm font-semibold text-gray-900">Add a cover photo</span>
            <span className="text-xs text-gray-500">It themes your planner and becomes the cover of your wedding website.</span>
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The best-practice first steps (lib/couple-planner-setup.ts). Items tick
 * themselves when the app sees them done, and the couple can tick or untick any
 * of them. It shrinks to one line once everything's done.
 */
function SetupChecklist({
  setup,
  onToggle,
}: {
  setup: NonNullable<HomeData['setup']>;
  onToggle: (key: PlannerSetupKey, done: boolean) => void;
}) {
  const allDone = setup.doneCount >= setup.total;
  // Collapsed until the couple opens it.
  const [open, setOpen] = useState(false);
  const pct = setup.total ? Math.round((setup.doneCount / setup.total) * 100) : 0;
  const byKey = new Map(setup.items.map((i) => [i.key, i]));

  return (
    <div className="mt-6 rounded-2xl border border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-4 px-5 pt-4 pb-3 text-left"
        aria-expanded={open}
      >
        <ProgressRing pct={pct} />
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-lg text-gray-900">
            {allDone ? 'Your planner is all set up' : 'Your next steps'}
          </h2>
          <p className="mt-0.5 text-sm text-gray-500">
            {allDone
              ? 'Every first step is done. Nice work!'
              : `${setup.doneCount} of ${setup.total} done · the essentials for a stress-free plan`}
          </p>
        </div>
        <ChevronDown className={`h-5 w-5 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul className="divide-y divide-gray-100 border-t border-gray-100">
          {PLANNER_SETUP_ITEMS.map((item) => {
            const state = byKey.get(item.key);
            if (!state) return null;
            const cta =
              'shrink-0 rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50';
            return (
              <li key={item.key} className="flex items-center gap-3 px-5 py-3.5">
                <button
                  type="button"
                  onClick={() => onToggle(item.key, !state.done)}
                  aria-label={state.done ? `Mark "${item.title}" as not done` : `Mark "${item.title}" as done`}
                  className="shrink-0"
                >
                  {state.done ? (
                    <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                  ) : (
                    <Circle className="h-6 w-6 text-gray-300 transition-colors hover:text-gray-400" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium ${state.done ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{item.title}</p>
                  <p className="text-xs text-gray-500">{item.desc}</p>
                </div>
                {!state.done &&
                  (item.href.startsWith('#') ? (
                    <a href={item.href} className={cta}>{item.cta}</a>
                  ) : (
                    <Link href={item.href} className={cta}>{item.cta}</Link>
                  ))}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ProgressRing({ pct }: { pct: number }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-12 w-12 shrink-0">
      <svg viewBox="0 0 44 44" className="h-12 w-12 -rotate-90">
        <circle cx="22" cy="22" r={r} fill="none" stroke="#f3f4f6" strokeWidth="5" />
        <circle
          cx="22"
          cy="22"
          r={r}
          fill="none"
          stroke="#10b981"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (c * pct) / 100}
          className="transition-all duration-500"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold text-gray-700">{pct}%</span>
    </div>
  );
}

/** The dashboard numbers, each linking to where it's managed. */
function MetricsGrid({ metrics }: { metrics: HomeMetrics }) {
  const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
  const count = (n: number) => n.toLocaleString('en-US');
  const shortDate = (d: string) => {
    const parsed = new Date(`${d}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? d : parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };
  const { website: w, guests: g, todos: t, budget: b } = metrics;
  const tiles: { href: string; label: string; value: string; sub: string; icon: React.ReactNode; tone: string }[] = [];

  if (w) {
    tiles.push({
      href: '/couple/site',
      label: 'Website views',
      value: count(w.views),
      sub:
        w.status === 'published'
          ? `+${count(w.viewsThisWeek)} this week`
          : w.status === 'draft'
            ? 'Publish your site to start'
            : 'Build your wedding website',
      icon: <Eye className="h-4 w-4" />,
      tone: 'bg-violet-50 text-violet-600',
    });
  }
  tiles.push({
    href: '/couple/guests',
    label: 'RSVP replies',
    value: count(g.replied),
    sub: g.total ? `${count(g.attending)} yes · ${count(g.declined)} no · ${count(g.awaiting)} waiting` : 'Add guests to collect RSVPs',
    icon: <MailCheck className="h-4 w-4" />,
    tone: 'bg-emerald-50 text-emerald-600',
  });
  tiles.push({
    href: '/couple/guests',
    label: 'Guests coming',
    value: count(g.headcount),
    sub: `${count(g.total)} on your guest list`,
    icon: <Users className="h-4 w-4" />,
    tone: 'bg-sky-50 text-sky-600',
  });
  if (w) {
    tiles.push({
      href: '/couple/site',
      label: 'Guestbook notes',
      value: count(w.guestbook),
      sub: 'Left on your website',
      icon: <MessageSquareHeart className="h-4 w-4" />,
      tone: 'bg-rose-50 text-rose-600',
    });
  }
  tiles.push({
    href: '/couple/checklist',
    label: 'To-dos done',
    value: t.total ? `${count(t.done)}/${count(t.total)}` : '0',
    sub: t.next ? `Next: ${t.next.title}${t.next.dueDate ? ` · ${shortDate(t.next.dueDate)}` : ''}` : t.total ? 'All caught up' : 'Start your checklist',
    icon: <ListChecks className="h-4 w-4" />,
    tone: 'bg-amber-50 text-amber-600',
  });
  if (b) {
    tiles.push({
      href: '/couple/budget',
      label: 'Budget spent',
      value: money(b.actual),
      sub: b.target > 0 ? `of ${money(b.target)} budget` : b.estimated > 0 ? `of ${money(b.estimated)} planned` : 'Set your budget',
      icon: <Wallet className="h-4 w-4" />,
      tone: 'bg-teal-50 text-teal-600',
    });
  }
  const pay = metrics.payments;
  if (pay) {
    tiles.push({
      href: pay.url,
      label: 'Paid to your venue',
      value: money(pay.paidCents / 100),
      sub: pay.next
        ? `Next: ${money(pay.next.amountCents / 100)} · ${pay.next.date ? shortDate(pay.next.date) : 'due now'}`
        : pay.balanceCents > 0
          ? `${money(pay.balanceCents / 100)} left`
          : 'Paid in full',
      icon: <CreditCard className="h-4 w-4" />,
      tone: 'bg-emerald-50 text-emerald-700',
    });
  }
  if (metrics.invitesSent != null) {
    tiles.push({
      href: '/couple/invite-guests',
      label: 'Invites sent',
      value: count(metrics.invitesSent),
      sub: 'Website invites emailed',
      icon: <Send className="h-4 w-4" />,
      tone: 'bg-indigo-50 text-indigo-600',
    });
  }
  tiles.push({
    href: '/couple/vendors',
    label: 'Vendors',
    value: count(metrics.vendors),
    sub: 'In your vendor list',
    icon: <Contact className="h-4 w-4" />,
    tone: 'bg-gray-100 text-gray-600',
  });

  return (
    <div className="mt-8">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Your wedding at a glance</h3>
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((tile) => (
          <Link
            key={tile.label}
            href={tile.href}
            className="group rounded-2xl border border-gray-200 bg-white p-4 transition-all hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-sm"
          >
            <div className="flex items-center justify-between">
              <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${tile.tone}`}>{tile.icon}</span>
              <ChevronRight className="h-4 w-4 text-gray-300 transition-transform group-hover:translate-x-0.5" />
            </div>
            <p className="mt-3 text-2xl font-semibold tabular-nums text-gray-900">{tile.value}</p>
            <p className="text-xs font-medium text-gray-700">{tile.label}</p>
            <p className="mt-0.5 truncate text-[11px] text-gray-500">{tile.sub}</p>
          </Link>
        ))}
      </div>
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
