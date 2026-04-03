'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  FileText,
  Users,
  CreditCard,
  BarChart2,
  HelpCircle,
  Settings,
  ArrowLeft,
} from 'lucide-react';

interface Venue {
  id: string;
  name: string;
  ghl_location_id: string;
}

interface SidebarProps {
  venue: Venue;
}

const menuItems = [
  { label: 'Overview', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Proposals', href: '/dashboard/proposals', icon: FileText },
  { label: 'Customers', href: '/dashboard/customers', icon: Users },
  { label: 'Transactions', href: '/dashboard/transactions', icon: CreditCard },
  { label: 'Reports', href: '/dashboard/reports', icon: BarChart2 },
  { label: 'Support', href: '/dashboard/support', icon: HelpCircle },
  { label: 'Settings', href: '/dashboard/settings', icon: Settings },
];

export default function Sidebar({ venue }: SidebarProps) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === '/dashboard') return pathname === '/dashboard';
    return pathname.startsWith(href);
  };

  const returnUrl = `https://login.storyvenuemarketing.com/v2/location/${venue.ghl_location_id}`;

  return (
    <aside
      className="fixed left-0 top-0 bottom-0 flex flex-col"
      style={{ width: 240, backgroundColor: '#293745' }}
    >
      <div className="px-5 pt-5 pb-3">
        <a
          href={returnUrl}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors mb-4"
        >
          <ArrowLeft size={14} />
          <span>Return to StoryVenue</span>
        </a>
        <Link href="/dashboard" className="block">
          <Image
            src="/storypay-logo-white.png"
            alt="StoryPay"
            width={160}
            height={40}
            priority
          />
        </Link>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);

          return (
            <Link
              key={item.label}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
              style={{
                backgroundColor: active ? '#354859' : undefined,
              }}
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.backgroundColor = '#2f3e4e';
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.backgroundColor = '';
              }}
            >
              <Icon size={18} className={active ? 'text-white' : ''} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="px-5 py-4 border-t border-white/10">
        <p className="text-xs text-gray-400 truncate mb-1">{venue.name}</p>
        <p className="text-[10px] text-gray-600">&copy; StoryVenue 2026</p>
      </div>
    </aside>
  );
}
