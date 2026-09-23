'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Users, MessageCircle, ListChecks, LayoutGrid } from 'lucide-react';

/**
 * Bottom navigation bar for the couple ("bride") app — visible on mobile +
 * tablet (below `lg`), mirroring the venue dashboard's MobileTabBar so the
 * bride area feels like the same native app. Four primary destinations plus a
 * "More" button that opens the full tool sheet. Couple is a free product, so
 * there are no Apple 3.1.1 concerns here.
 */
const TABS = [
  { label: 'Home',      href: '/couple/wedding',   icon: Home,          match: ['/couple/wedding'] },
  { label: 'Guests',    href: '/couple/guests',    icon: Users,         match: ['/couple/guests'] },
  { label: 'Messages',  href: '/couple/messages',  icon: MessageCircle, match: ['/couple/messages'] },
  { label: 'Checklist', href: '/couple/checklist', icon: ListChecks,    match: ['/couple/checklist'] },
];

// Routes that live behind the "More" sheet — used to light up the More tab.
const MORE_MATCHES = [
  '/couple/seating',
  '/couple/timeline',
  '/couple/budget',
  '/couple/vendors',
  '/couple/inspiration',
  '/couple/site',
  '/couple/invite-guests',
  '/couple/favorites',
  '/couple/profile',
  '/couple/help',
];

export default function CoupleMobileTabBar({
  moreOpen,
  onMore,
}: {
  moreOpen: boolean;
  onMore: () => void;
}) {
  const pathname = usePathname();
  const moreActive = moreOpen || MORE_MATCHES.some((m) => pathname.startsWith(m));

  return (
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white"
      style={{
        paddingTop: '4px',
        // max() ensures at least 10px below icons where safe-area-inset-bottom
        // is 0 (older Androids, desktop preview); notched iPhones get ~34px.
        paddingBottom: 'max(env(safe-area-inset-bottom), 10px)',
      }}
    >
      <ul className="grid grid-cols-5 px-2">
        {TABS.map(({ label, href, icon: Icon, match }) => {
          const active = match.some((m) => pathname.startsWith(m));
          return (
            <li key={label}>
              <Link
                href={href}
                prefetch={true}
                className={`flex flex-col items-center justify-center gap-1.5 py-3.5 text-[11px] font-medium transition-colors ${
                  active ? 'text-gray-900' : 'text-gray-400'
                }`}
              >
                <Icon size={20} strokeWidth={active ? 2.2 : 1.8} />
                <span className="truncate max-w-full px-0.5 leading-tight">{label}</span>
              </Link>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={onMore}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            className={`flex w-full flex-col items-center justify-center gap-1.5 py-3.5 text-[11px] font-medium transition-colors ${
              moreActive ? 'text-gray-900' : 'text-gray-400'
            }`}
          >
            <LayoutGrid size={20} strokeWidth={moreActive ? 2.2 : 1.8} />
            <span className="truncate max-w-full px-0.5 leading-tight">More</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
