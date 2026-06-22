'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Home, MessageCircle, Inbox, Calendar, CreditCard } from 'lucide-react';

/**
 * Bottom navigation bar — visible on mobile + tablet (below `lg`) across
 * every dashboard page. Mirrors the native-app pattern used by virtually
 * every consumer mobile app.
 */
const TABS = [
  { label: 'Home',        href: '/dashboard/home',          icon: Home,          match: ['/dashboard/home', '/dashboard'] },
  { label: 'Messages',    href: '/dashboard/conversations', icon: MessageCircle, match: ['/dashboard/conversations'] },
  { label: 'Lead Inbox',  href: '/dashboard/leads',         icon: Inbox,         match: ['/dashboard/leads'] },
  { label: 'Calendar',    href: '/dashboard/calendar',      icon: Calendar,      match: ['/dashboard/calendar'] },
  { label: 'Payments',    href: '/dashboard/payments/new',  icon: CreditCard,    match: ['/dashboard/payments', '/dashboard/transactions', '/dashboard/proposals', '/dashboard/offerings'] },
];

export default function MobileTabBar() {
  const pathname = usePathname();
  const [unreadMessages, setUnreadMessages] = useState(0);

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
          const showBadge = label === 'Messages' && unreadMessages > 0;
          return (
            <li key={label}>
              <Link
                href={href}
                className={`flex flex-col items-center justify-center gap-1.5 py-3.5 text-[11px] font-medium transition-colors ${
                  active ? 'text-gray-900' : 'text-gray-400'
                }`}
              >
                <span className="relative inline-flex">
                  <Icon size={20} strokeWidth={active ? 2.2 : 1.8} />
                  {showBadge && (
                    <span className="absolute -right-1.5 -top-1 min-w-[16px] rounded-full bg-red-600 px-1 text-center text-[9px] font-bold leading-4 text-white">
                      {unreadMessages > 99 ? '99+' : unreadMessages}
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
