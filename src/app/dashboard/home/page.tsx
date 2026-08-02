'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MessageCircle, Inbox, Calendar, Phone, ChevronRight, Clock, MapPin, CheckCircle2, Check,
} from 'lucide-react';
import { getClientCache, setClientCache } from '@/lib/client-cache';

/**
 * "Today" home screen — the default landing screen on mobile / the native app.
 *
 * Purpose-built to answer one question the moment a venue owner opens the app:
 * "what needs me right now?" — unread conversations they can call/text in one
 * tap, plus today's schedule. Reuses existing endpoints only (no new backend).
 *
 * Desktop redirects to the full dashboard, so this is intentionally mobile-first.
 */

type Thread = {
  thread_id: string;
  venue_customer_id: string | null;
  contact_first_name: string;
  contact_last_name: string;
  contact_phone: string | null;
  contact_email: string;
  last_message_preview: string | null;
  last_message_at: string | null;
  unread_count?: number;
};

type CalEvent = {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  all_day?: boolean;
  event_type?: string | null;
  venue_spaces?: { name?: string | null } | null;
};

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  });
}

function initials(first: string, last: string): string {
  const a = (first || '').trim();
  const b = (last || '').trim();
  const i = (a[0] || '') + (b[0] || '');
  return (i || '?').toUpperCase();
}

function formatPhone(raw: string | null): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, '');
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  if (ten.length === 10) return `${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}`;
  return raw;
}

function relTime(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.round(hrs / 24);
  return `${days}d`;
}

function eventTime(ev: CalEvent): string {
  if (ev.all_day) return 'All day';
  const d = new Date(ev.start_at);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/**
 * One "Needs a reply" card — swipe it left (past ~40% of its width) or tap
 * the check button to clear it. Clearing marks the thread read on the server
 * so it stays gone and the unread badges update everywhere.
 */
function ReplyCard({
  t,
  onDismiss,
}: {
  t: Thread;
  onDismiss: (t: Thread) => void;
}) {
  const [dx, setDx] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const swiping = useRef(false);

  const name = `${t.contact_first_name || ''} ${t.contact_last_name || ''}`.trim() || t.contact_email || 'Contact';
  const phone = formatPhone(t.contact_phone);
  const openHref = t.venue_customer_id
    ? `/dashboard/conversations?customer=${t.venue_customer_id}`
    : `/dashboard/conversations?customerFromEmail=${encodeURIComponent(t.contact_email || '')}`;
  const textHref = t.venue_customer_id
    ? `/dashboard/conversations?customer=${t.venue_customer_id}&compose=sms`
    : `/dashboard/conversations?customerFromEmail=${encodeURIComponent(t.contact_email || '')}&compose=sms`;

  function dismiss() {
    if (leaving) return;
    setLeaving(true);
    // Let the slide-out animation play before removing from the list.
    setTimeout(() => onDismiss(t), 200);
  }

  return (
    <li className="relative overflow-hidden rounded-2xl">
      {/* Backdrop revealed while swiping */}
      <div className="absolute inset-0 flex items-center justify-end rounded-2xl bg-emerald-500 pr-5">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-white">
          <Check size={16} /> Done
        </span>
      </div>
      <div
        className="relative rounded-2xl border border-gray-200 bg-white p-3"
        style={{
          transform: leaving ? 'translateX(-110%)' : `translateX(${dx}px)`,
          opacity: leaving ? 0 : 1,
          transition: swiping.current ? 'none' : 'transform 200ms ease, opacity 200ms ease',
        }}
        onTouchStart={(e) => {
          startX.current = e.touches[0].clientX;
          startY.current = e.touches[0].clientY;
          swiping.current = false;
        }}
        onTouchMove={(e) => {
          const moveX = e.touches[0].clientX - startX.current;
          const moveY = e.touches[0].clientY - startY.current;
          // Only hijack clear horizontal left-swipes; let vertical scrolling win.
          if (!swiping.current && (Math.abs(moveX) < 10 || Math.abs(moveY) > Math.abs(moveX))) return;
          swiping.current = true;
          setDx(Math.min(0, moveX));
        }}
        onTouchEnd={(e) => {
          if (!swiping.current) return;
          const width = (e.currentTarget as HTMLElement).offsetWidth || 320;
          if (dx < -width * 0.4) {
            dismiss();
          } else {
            swiping.current = false;
            setDx(0);
          }
        }}
      >
        <Link href={openHref} className="flex items-start gap-3" draggable={false}>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1B1B1B] text-[13px] font-semibold text-white">
            {initials(t.contact_first_name, t.contact_last_name)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-semibold text-gray-900">{name}</span>
              <span className="shrink-0 text-[11px] text-gray-400">{relTime(t.last_message_at)}</span>
            </span>
            {t.last_message_preview ? (
              <span className="mt-0.5 line-clamp-1 block text-xs text-gray-500">{t.last_message_preview}</span>
            ) : null}
          </span>
        </Link>
        <div className="mt-2.5 flex items-center gap-2 pl-[52px]">
          {phone ? (
            <a
              href={`tel:${(t.contact_phone || '').replace(/[^\d+]/g, '')}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 active:bg-gray-100"
            >
              <Phone size={13} /> Call
            </a>
          ) : null}
          <Link
            href={textHref}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 active:bg-gray-100"
          >
            <MessageCircle size={13} /> Text
          </Link>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Mark as handled"
            className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-400 active:bg-gray-100 active:text-emerald-600"
          >
            <Check size={15} />
          </button>
        </div>
      </div>
    </li>
  );
}

export default function MobileHomePage() {
  // Seed everything from the session cache so returning to Home paints the
  // previous data instantly (no skeleton flash / card resize) while the
  // fetches below refresh quietly in the background.
  const [unread, setUnread] = useState(() => getClientCache<number>('home:unread') ?? 0);
  const [newLeads, setNewLeads] = useState(() => getClientCache<number>('home:newLeads') ?? 0);
  const [threads, setThreads] = useState<Thread[]>(() => getClientCache<Thread[]>('home:threads') ?? []);
  const [events, setEvents] = useState<CalEvent[]>(() => getClientCache<CalEvent[]>('home:events') ?? []);
  const [loading, setLoading] = useState(() => getClientCache<Thread[]>('home:threads') === undefined);

  useEffect(() => {
    let cancelled = false;

    // Unread conversation count (metric card).
    fetch('/api/conversations/unread-count')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { count?: number } | null) => {
        if (!cancelled && d && typeof d.count === 'number') {
          setUnread(d.count);
          setClientCache('home:unread', d.count);
        }
      })
      .catch(() => {});

    // New leads in the last 7 days (metric card).
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    fetch(`/api/leads/unread-count?since=${encodeURIComponent(weekAgo)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { count?: number } | null) => {
        if (!cancelled && d && typeof d.count === 'number') {
          setNewLeads(d.count);
          setClientCache('home:newLeads', d.count);
        }
      })
      .catch(() => {});

    // Unread threads → "Needs a reply" list.
    fetch('/api/conversations/threads?unread=1')
      .then((r) => (r.ok ? r.json() : null))
      .then((rows: Thread[] | null) => {
        if (!cancelled && Array.isArray(rows)) {
          const top = rows.slice(0, 8);
          setThreads(top);
          setClientCache('home:threads', top);
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });

    // Today's calendar events → "Today's schedule".
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(); end.setHours(23, 59, 59, 999);
    fetch(`/api/calendar?from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((rows: CalEvent[] | null) => {
        if (cancelled || !Array.isArray(rows)) return;
        const s = start.getTime();
        const e = end.getTime();
        const todays = rows
          .filter((ev) => {
            const t = new Date(ev.start_at).getTime();
            return !Number.isNaN(t) && t >= s && t <= e;
          })
          .sort((a, b) => a.start_at.localeCompare(b.start_at));
        setEvents(todays);
        setClientCache('home:events', todays);
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, []);

  // Clearing a card marks the thread read server-side (so it stays cleared
  // and reappears only if the contact messages again), removes it locally,
  // and nudges the tab-bar badge to refresh.
  function dismissThread(t: Thread) {
    setThreads((prev) => {
      const next = prev.filter((x) => x.thread_id !== t.thread_id);
      setClientCache('home:threads', next);
      return next;
    });
    setUnread((prev) => {
      const next = Math.max(0, prev - 1);
      setClientCache('home:unread', next);
      return next;
    });
    fetch(`/api/conversations/threads/${t.thread_id}/read`, { method: 'POST' })
      .then(() => window.dispatchEvent(new CustomEvent('storypay:conversations-unread')))
      .catch(() => {});
  }

  const eventsToday = events.length;

  const metrics = useMemo(
    () => [
      { label: 'Unread', value: unread, href: '/dashboard/conversations', icon: <MessageCircle size={16} />, tint: 'bg-rose-50 text-rose-700' },
      { label: 'New leads', value: newLeads, href: '/dashboard/leads', icon: <Inbox size={16} />, tint: 'bg-amber-50 text-amber-700' },
      { label: 'Today', value: eventsToday, href: '/dashboard/calendar', icon: <Calendar size={16} />, tint: 'bg-emerald-50 text-emerald-700' },
    ],
    [unread, newLeads, eventsToday],
  );

  return (
    // No max-width cap — matches every other native tab (Messages, Contacts,
    // Calendar), which all use the full available width with no inner cap.
    <div>
      {/* Greeting */}
      <div className="pb-1">
        <h1 className="font-heading text-2xl text-gray-900">{greeting()}</h1>
        <p className="mt-0.5 text-sm text-gray-500">{todayLabel()}</p>
      </div>

      {/* Metric cards */}
      <div className="mt-4 grid grid-cols-3 gap-2.5">
        {metrics.map((m) => (
          <Link
            key={m.label}
            href={m.href}
            className="block rounded-2xl border border-gray-200 bg-white p-3 transition-colors active:bg-gray-50"
          >
            <div className={`mb-2 inline-flex h-8 w-8 items-center justify-center rounded-full ${m.tint}`}>
              {m.icon}
            </div>
            <div className="font-heading text-xl text-gray-900 tabular-nums">{m.value}</div>
            <div className="text-[11px] uppercase tracking-wide text-gray-500">{m.label}</div>
          </Link>
        ))}
      </div>

      {/* Needs a reply */}
      <section className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Needs a reply</h2>
          <Link href="/dashboard/conversations" className="text-xs font-medium text-gray-500 hover:text-gray-900">
            View all
          </Link>
        </div>

        {loading ? (
          <div className="space-y-2">
            {/* Skeleton heights match the real card height so nothing visibly
                grows/resizes when data arrives. */}
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[106px] animate-pulse rounded-2xl border border-gray-200 bg-gray-50" />
            ))}
          </div>
        ) : threads.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-gray-200 bg-white px-6 py-8 text-center">
            <CheckCircle2 size={28} className="mb-2 text-emerald-500" />
            <p className="text-sm font-semibold text-gray-800">You&apos;re all caught up</p>
            <p className="mt-1 text-xs text-gray-500">No unread messages waiting on you.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {threads.map((t) => (
              <ReplyCard key={t.thread_id} t={t} onDismiss={dismissThread} />
            ))}
          </ul>
        )}
      </section>

      {/* Today's schedule */}
      <section className="mt-6 pb-32">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Today&apos;s schedule</h2>
          <Link href="/dashboard/calendar" className="text-xs font-medium text-gray-500 hover:text-gray-900">
            Open calendar
          </Link>
        </div>

        {loading ? (
          <div className="h-[140px] animate-pulse rounded-2xl border border-gray-200 bg-gray-50" />
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-gray-200 bg-white px-6 py-8 text-center">
            <Calendar size={26} className="mb-2 text-gray-300" />
            <p className="text-sm font-semibold text-gray-800">Nothing on the calendar today</p>
            <Link href="/dashboard/calendar" className="mt-2 text-xs font-medium text-gray-500 hover:text-gray-900">
              Book an event
            </Link>
          </div>
        ) : (
          <ul className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
            {events.map((ev) => {
              const spaceName = ev.venue_spaces?.name || null;
              return (
                <li key={ev.id} className="border-b border-gray-100 last:border-b-0">
                  <Link href="/dashboard/calendar" className="flex items-center gap-3 px-4 py-3 active:bg-gray-50">
                    <span className="flex w-16 shrink-0 flex-col items-start">
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-gray-900">
                        <Clock size={12} className="text-gray-400" /> {eventTime(ev)}
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-gray-900">{ev.title || 'Event'}</span>
                      {spaceName ? (
                        <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-gray-500">
                          <MapPin size={11} /> {spaceName}
                        </span>
                      ) : null}
                    </span>
                    <ChevronRight size={16} className="shrink-0 text-gray-300" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
