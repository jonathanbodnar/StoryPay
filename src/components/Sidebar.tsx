'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  FileText,
  FileStack,
  Users,
  MessageSquare,
  CreditCard,
  HelpCircle,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useState } from 'react';

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
  {
    label: 'Proposals',
    href: '/dashboard/proposals',
    icon: FileText,
    children: [
      { label: 'Templates', href: '/dashboard/proposals/templates', icon: FileStack },
    ],
  },
  { label: 'Customers', href: '/dashboard/customers', icon: Users },
  { label: 'SMS', href: '/dashboard/sms', icon: MessageSquare },
  { label: 'Transactions', href: '/dashboard/transactions', icon: CreditCard },
  { label: 'Support', href: '/dashboard/support', icon: HelpCircle },
];

export default function Sidebar({ venue }: SidebarProps) {
  const pathname = usePathname();
  const [expandedItems, setExpandedItems] = useState<string[]>(['Proposals']);

  const isActive = (href: string) => {
    if (href === '/dashboard') return pathname === '/dashboard';
    return pathname.startsWith(href);
  };

  const toggleExpand = (label: string) => {
    setExpandedItems((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]
    );
  };

  const returnUrl = `https://login.storyvenuemarketing.com/v2/location/${venue.ghl_location_id}`;

  return (
    <aside
      className="fixed left-0 top-0 bottom-0 flex flex-col"
      style={{ width: 240, backgroundColor: '#0f1a2e' }}
    >
      <div className="px-5 pt-5 pb-3">
        <a
          href={returnUrl}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors mb-4"
        >
          <ArrowLeft size={14} />
          <span>Return to StoryVenue</span>
        </a>
        <div
          className="text-xl text-white tracking-tight"
          style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontStyle: 'italic' }}
        >
          StoryPay
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          const hasChildren = item.children && item.children.length > 0;
          const expanded = expandedItems.includes(item.label);

          return (
            <div key={item.label}>
              <div className="flex items-center">
                <Link
                  href={item.href}
                  className={`flex-1 flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    active
                      ? 'text-white'
                      : 'text-gray-400 hover:text-white hover:bg-white/5'
                  }`}
                  style={active ? { backgroundColor: 'rgba(56, 189, 248, 0.12)' } : undefined}
                >
                  <Icon size={18} className={active ? 'text-sky-400' : ''} />
                  <span>{item.label}</span>
                </Link>
                {hasChildren && (
                  <button
                    onClick={() => toggleExpand(item.label)}
                    className="p-1 text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                )}
              </div>

              {hasChildren && expanded && (
                <div className="ml-4 mt-0.5 space-y-0.5">
                  {item.children!.map((child) => {
                    const ChildIcon = child.icon;
                    const childActive = isActive(child.href);

                    return (
                      <Link
                        key={child.label}
                        href={child.href}
                        className={`flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                          childActive
                            ? 'text-white'
                            : 'text-gray-500 hover:text-white hover:bg-white/5'
                        }`}
                        style={
                          childActive
                            ? { backgroundColor: 'rgba(56, 189, 248, 0.12)' }
                            : undefined
                        }
                      >
                        <ChildIcon size={16} className={childActive ? 'text-sky-400' : ''} />
                        <span>{child.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="px-5 py-4 border-t border-white/10">
        <p className="text-xs text-gray-500 truncate">{venue.name}</p>
      </div>
    </aside>
  );
}
