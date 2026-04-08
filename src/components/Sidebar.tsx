'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  FileText,
  Users,
  CreditCard,
  BarChart2,
  Sparkles,
  Megaphone,
  HelpCircle,
  Settings,
  Palette,
  Mail,
  UsersRound,
  Bell,
  Package,
  Receipt,
  Link2,
  RefreshCw,
  DollarSign,
  ArrowLeft,
  Menu,
  X,
  ChevronDown,
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
  { label: 'Ask AI',        href: '/dashboard/ai',           icon: Sparkles },
  { label: 'Home',          href: '/dashboard',              icon: LayoutDashboard },
  { label: 'Proposals',    href: '/dashboard/proposals',    icon: FileText },
  { label: 'Customers',    href: '/dashboard/customers',    icon: Users },
  { label: 'Reports',      href: '/dashboard/reports',      icon: BarChart2 },
  { label: "What's New",   href: '/dashboard/updates',      icon: Megaphone },
  { label: 'Support',       href: '/dashboard/support',      icon: HelpCircle },
];

const paymentsItems = [
  { label: 'Invoices',       href: '/dashboard/invoices/new',             icon: Receipt },
  { label: 'Payment Links',  href: '/dashboard/payments/payment-links',   icon: Link2 },
  { label: 'Transactions',   href: '/dashboard/transactions',             icon: CreditCard },
  { label: 'Subscriptions',  href: '/dashboard/payments/subscriptions',   icon: RefreshCw },
  { label: 'Payouts',        href: '/dashboard/payments/payouts',         icon: DollarSign },
];

const settingsItems = [
  { label: 'General',         href: '/dashboard/settings',                  icon: Settings },
  { label: 'Branding',        href: '/dashboard/settings/branding',         icon: Palette },
  { label: 'Email Templates', href: '/dashboard/settings/email-templates',  icon: Mail },
  { label: 'Team',            href: '/dashboard/settings/team',             icon: UsersRound },
  { label: 'Notifications',   href: '/dashboard/settings/notifications',    icon: Bell },
];

export default function Sidebar({ venue }: SidebarProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const isOnSettings = pathname.startsWith('/dashboard/settings');
  const [settingsOpen, setSettingsOpen] = useState(isOnSettings);
  const isOnPayments = pathname.startsWith('/dashboard/payments') || pathname.startsWith('/dashboard/transactions') || pathname.startsWith('/dashboard/invoices');
  const [paymentsOpen, setPaymentsOpen] = useState(isOnPayments);

  // Auto-expand when navigating to relevant sections
  useEffect(() => { if (isOnSettings) setSettingsOpen(true); }, [isOnSettings]);
  useEffect(() => { if (isOnPayments) setPaymentsOpen(true); }, [isOnPayments]);

  // Close on route change
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  // Prevent body scroll when mobile nav is open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  const isActive = (href: string) => {
    if (href === '/dashboard') return pathname === '/dashboard';
    return pathname.startsWith(href);
  };

  const returnUrl = `https://login.storyvenuemarketing.com/v2/location/${venue.ghl_location_id}`;

  const NavContent = () => (
    <>
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
            src="/StoryPay-Light-Logo.png"
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
          const isAskAI = item.label === 'Ask AI' || item.label === 'Support';
          return (
            <Link
              key={item.label}
              href={isAskAI ? '#' : item.href}
              onClick={isAskAI ? (e) => { e.preventDefault(); window.dispatchEvent(new Event('open-ask-ai')); } : undefined}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active && !isAskAI ? 'text-white' : 'text-gray-400 hover:text-white'
              }`}
              style={{ backgroundColor: active && !isAskAI ? '#354859' : undefined }}
              onMouseEnter={(e) => { if (!(active && !isAskAI)) e.currentTarget.style.backgroundColor = '#2f3e4e'; }}
              onMouseLeave={(e) => { if (!(active && !isAskAI)) e.currentTarget.style.backgroundColor = ''; }}
            >
              <Icon size={18} className={active ? 'text-white' : ''} />
              <span>{item.label}</span>
            </Link>
          );
        })}

        {/* Payments group — collapsible */}
        <div>
          <button
            type="button"
            onClick={() => setPaymentsOpen(v => !v)}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              isOnPayments ? 'text-white' : 'text-gray-400 hover:text-white'
            }`}
            style={{ backgroundColor: isOnPayments ? '#354859' : undefined }}
            onMouseEnter={(e) => { if (!isOnPayments) e.currentTarget.style.backgroundColor = '#2f3e4e'; }}
            onMouseLeave={(e) => { if (!isOnPayments) e.currentTarget.style.backgroundColor = ''; }}
          >
            <div className="flex items-center gap-3">
              <CreditCard size={18} className={isOnPayments ? 'text-white' : ''} />
              <span>Payments</span>
            </div>
            <ChevronDown
              size={14}
              className={`transition-transform duration-200 flex-shrink-0 ${paymentsOpen ? 'rotate-180 text-white/60' : 'text-gray-500'}`}
            />
          </button>
          {paymentsOpen && (
            <div className="mt-0.5 ml-4 pl-3 border-l border-white/10 space-y-0.5">
              {paymentsItems.map((sub) => {
                const SubIcon = sub.icon;
                const subActive = pathname === sub.href || pathname.startsWith(sub.href);
                return (
                  <Link
                    key={sub.label}
                    href={sub.href}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                      subActive ? 'text-white font-medium' : 'text-gray-400 hover:text-white'
                    }`}
                    style={{ backgroundColor: subActive ? '#354859' : undefined }}
                    onMouseEnter={(e) => { if (!subActive) e.currentTarget.style.backgroundColor = '#2f3e4e'; }}
                    onMouseLeave={(e) => { if (!subActive) e.currentTarget.style.backgroundColor = ''; }}
                  >
                    <SubIcon size={15} />
                    <span>{sub.label}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Products */}
        {(() => {
          const active = isActive('/dashboard/products');
          return (
            <Link
              href="/dashboard/products"
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active ? 'text-white' : 'text-gray-400 hover:text-white'
              }`}
              style={{ backgroundColor: active ? '#354859' : undefined }}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.backgroundColor = '#2f3e4e'; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.backgroundColor = ''; }}
            >
              <Package size={18} className={active ? 'text-white' : ''} />
              <span>Products</span>
            </Link>
          );
        })()}

        {/* Settings group — fully collapsible row */}
        <div>
          <button
            type="button"
            onClick={() => setSettingsOpen(v => !v)}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              isOnSettings ? 'text-white' : 'text-gray-400 hover:text-white'
            }`}
            style={{ backgroundColor: isOnSettings ? '#354859' : undefined }}
            onMouseEnter={(e) => { if (!isOnSettings) e.currentTarget.style.backgroundColor = '#2f3e4e'; }}
            onMouseLeave={(e) => { if (!isOnSettings) e.currentTarget.style.backgroundColor = ''; }}
          >
            <div className="flex items-center gap-3">
              <Settings size={18} className={isOnSettings ? 'text-white' : ''} />
              <span>Settings</span>
            </div>
            <ChevronDown
              size={14}
              className={`transition-transform duration-200 flex-shrink-0 ${settingsOpen ? 'rotate-180 text-white/60' : 'text-gray-500'}`}
            />
          </button>

          {/* Sub-items */}
          {settingsOpen && (
            <div className="mt-0.5 ml-4 pl-3 border-l border-white/10 space-y-0.5">
              {settingsItems.map((sub) => {
                const SubIcon = sub.icon;
                const subActive = pathname === sub.href;
                return (
                  <Link
                    key={sub.label}
                    href={sub.href}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                      subActive ? 'text-white font-medium' : 'text-gray-400 hover:text-white'
                    }`}
                    style={{ backgroundColor: subActive ? '#354859' : undefined }}
                    onMouseEnter={(e) => { if (!subActive) e.currentTarget.style.backgroundColor = '#2f3e4e'; }}
                    onMouseLeave={(e) => { if (!subActive) e.currentTarget.style.backgroundColor = ''; }}
                  >
                    <SubIcon size={15} />
                    <span>{sub.label}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </nav>

      <div className="px-5 py-4 border-t border-white/10">
        <p className="text-xs text-gray-400 truncate mb-1">{venue.name}</p>
        <p className="text-[10px] text-gray-600">&copy; StoryVenue 2026</p>
      </div>
    </>
  );

  return (
    <>
      {/* ── Mobile top bar ── */}
      <div
        className="lg:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 h-14"
        style={{ backgroundColor: '#293745' }}
      >
        <Link href="/dashboard">
          <Image src="/StoryPay-Light-Logo.png" alt="StoryPay" width={120} height={30} priority />
        </Link>
        <button
          onClick={() => setMobileOpen(v => !v)}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-white hover:bg-white/10 transition-colors"
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* ── Mobile drawer backdrop ── */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── Mobile drawer ── */}
      <aside
        className={`lg:hidden fixed top-0 left-0 bottom-0 z-50 flex flex-col w-[240px] transition-transform duration-300 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ backgroundColor: '#293745' }}
      >
        <NavContent />
      </aside>

      {/* ── Desktop sidebar (always visible) ── */}
      <aside
        className="hidden lg:flex fixed left-0 top-0 bottom-0 flex-col"
        style={{ width: 240, backgroundColor: '#293745' }}
      >
        <NavContent />
      </aside>
    </>
  );
}
