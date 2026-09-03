'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Home, MessageCircle, Inbox, Calendar, CreditCard, ConciergeBell, Lock } from 'lucide-react';
import { LEADS_SEEN_KEY } from '@/lib/leads-badge';
import { useBroadcastChannel } from '@/lib/realtime/use-broadcast-channel';
import { supportChannels } from '@/lib/realtime/channels';
import { isNativeApp } from '@/lib/platform';

/**
 * Bottom navigation bar — visible on mobile + tablet (below `lg`) across
 * every dashboard page.
 *
 * Native app store shell (Capacitor): shows the approved 5-tab set that
 * matches the locked-in app store menu — no Payments tab (Apple rule).
 *
 * Web PWA / browser: shows the original 5-tab set including Payments.
 */
const PWA_TABS = [
  { label: 'Home',        href: '/dashboard/home',          icon: Home,          match: ['/dashboard/home', '/dashboard'] },
  { label: 'Messages',    href: '/dashboard/conversations', icon: MessageCircle, match: ['/dashboard/conversations'] },
  { label: 'Lead Inbox',  href: '/dashboard/leads',         icon: Inbox,         match: ['/dashboard/leads'] },
  { label: 'Calendar',    href: '/dashboard/calendar',      icon: Calendar,      match: ['/dashboard/calendar'] },
  { label: 'Payments',    href: '/dashboard/payments/new',  icon: CreditCard,    match: ['/dashboard/payments', '/dashboard/transactions', '/dashboard/proposals', '/dashboard/offerings'] },
];

const NATIVE_TABS = [
  { label: 'Home',        href: '/dashboard/home',            icon: Home,          match: ['/dashboard/home', '/dashboard'] },
  { label: 'Lead Inbox',  href: '/dashboard/leads',           icon: Inbox,         match: ['/dashboard/leads'] },
  { label: 'Messages',    href: '/dashboard/conversations',   icon: MessageCircle, match: ['/dashboard/conversations'] },
  { label: 'Concierge',   href: '/dashboard/venue-concierge', icon: ConciergeBell, match: ['/dashboard/venue-concierge'] },
  { label: 'Calendar',    href: '/dashboard/calendar',        icon: Calendar,      match: ['/dashboard/calendar'] },
];

export default function MobileTabBar({ venueId, hasConciergeAddon = false }: { venueId?: string | null; hasConciergeAddon?: boolean }) {
  const pathname = usePathname();
  const TABS = isNativeApp() ? NATIVE_TABS : PWA_TABS;
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [unreadLeads, setUnreadLeads] = useState(0);
  const [unreadConcierge, setUnreadConcierge] = useState(0);

  // Poll the conversations unread count — same endpoint as the desktop sidebar
  useEffect(() => {
    const load = () =>
      fetch('/api/conversations/unread-count')
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { count?: number } | null) => {
          if (d && typeof d.count === 'number') setUnreadMessages(d.count);
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 45_000);
    const onEvt = () => load();
    window.addEventListener('storypay:conversations-unread', onEvt);
    return () => {
      clearInterval(t);
      window.removeEventListener('storypay:conversations-unread', onEvt);
    };
  }, []);

  // Venue Concierge unread badge — only meaningful when the add-on is active.
  useEffect(() => {
    if (!hasConciergeAddon) return;
    const load = () =>
      fetch('/api/venue-concierge/unread')
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { count?: number } | null) => {
          if (d && typeof d.count === 'number') setUnreadConcierge(d.count);
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 45_000);
    const onEvt = () => load();
    window.addEventListener('storypay:venue-concierge-unread', onEvt);
    return () => {
      clearInterval(t);
      window.removeEventListener('storypay:venue-concierge-unread', onEvt);
    };
  }, [hasConciergeAddon]);

  // New-leads badge — mirrors the desktop sidebar (shared localStorage baseline,
  // cleared when the Lead Inbox is opened).
  const refreshLeads = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (window.location.pathname.startsWith('/dashboard/leads')) {
      try { localStorage.setItem(LEADS_SEEN_KEY, new Date().toISOString()); } catch {}
      setUnreadLeads(0);
      return;
    }
    let since: string | null = null;
    try { since = localStorage.getItem(LEADS_SEEN_KEY); } catch {}
    const qs = since ? `?since=${encodeURIComponent(since)}` : '';
    fetch(`/api/leads/unread-count${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { count?: number; latest?: string | null } | null) => {
        if (!d) return;
        if (!since) {
          try { localStorage.setItem(LEADS_SEEN_KEY, d.latest ?? new Date().toISOString()); } catch {}
          setUnreadLeads(0);
          return;
        }
        if (typeof d.count === 'number') setUnreadLeads(d.count);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshLeads();
    const t = setInterval(refreshLeads, 45_000);
    const onEvt = () => refreshLeads();
    window.addEventListener('storypay:leads-unread', onEvt);
    return () => {
      clearInterval(t);
      window.removeEventListener('storypay:leads-unread', onEvt);
    };
  }, [refreshLeads]);

  // Instant badge: a new lead for this venue fires a realtime broadcast.
  useBroadcastChannel(
    venueId ? supportChannels.venueLeads(venueId) : null,
    ['new_lead'],
    () => { refreshLeads(); },
  );

  // Opening the Lead Inbox acknowledges everything so far.
  useEffect(() => {
    if (pathname.startsWith('/dashboard/leads')) {
      try { localStorage.setItem(LEADS_SEEN_KEY, new Date().toISOString()); } catch {}
      setUnreadLeads(0);
    }
  }, [pathname]);

  return (
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white"
      style={{
        paddingTop: '4px',
        // max() ensures at least 10 px below icons on devices where
        // safe-area-inset-bottom is 0 (older Androids, desktop preview).
        // iPhones with a home indicator already get ~34 px from the env().
        paddingBottom: 'max(env(safe-area-inset-bottom), 10px)',
      }}
    >
      <ul className="grid grid-cols-5 px-2">
        {TABS.map(({ label, href, icon: Icon, match }) => {
          const active = match.some((m) =>
            m === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(m),
          );
          const isConcierge = label === 'Concierge';
          const conciergeLocked = isConcierge && !hasConciergeAddon;
          const badgeCount = label === 'Messages'
            ? unreadMessages
            : label === 'Lead Inbox'
              ? unreadLeads
              : isConcierge && hasConciergeAddon
                ? unreadConcierge
                : 0;
          const showBadge = badgeCount > 0 && !conciergeLocked;
          return (
            <li key={label}>
              <Link
                href={href}
                // Full prefetch: warms every tab's RSC payload up front so the
                // first tap on each tab renders from the client cache instead
                // of waiting on a network round-trip.
                prefetch={true}
                className={`flex flex-col items-center justify-center gap-1.5 py-3.5 text-[11px] font-medium transition-colors ${
                  active ? 'text-gray-900' : 'text-gray-400'
                }`}
              >
                <span className="relative inline-flex">
                  <Icon size={20} strokeWidth={active ? 2.2 : 1.8} />
                  {conciergeLocked && (
                    <span className="absolute -right-1.5 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-gray-200 text-gray-500 ring-2 ring-white">
                      <Lock size={8} strokeWidth={2.6} />
                    </span>
                  )}
                  {showBadge && (
                    <span className="absolute -right-1.5 -top-1 min-w-[16px] rounded-full bg-red-600 px-1 text-center text-[9px] font-bold leading-4 text-white">
                      {badgeCount > 99 ? '99+' : badgeCount}
                    </span>
                  )}
                </span>
                <span className="truncate max-w-full px-0.5 leading-tight">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
