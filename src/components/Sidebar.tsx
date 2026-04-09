'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import {
  LayoutDashboard, FileText, Users, CreditCard, BarChart2,
  Sparkles, Megaphone, Settings, Palette, Mail, UsersRound,
  Bell, Package, Receipt, Link2, RefreshCw, DollarSign, Plus,
  ArrowLeft, Menu, X, ChevronDown,
  HelpCircle,
} from 'lucide-react';

interface Venue { id: string; name: string; ghl_location_id: string; }
interface SidebarProps { venue: Venue; }

const menuItems = [
  { label: 'Ask AI',       href: '/dashboard/ai',        icon: Sparkles },
  { label: 'Home',         href: '/dashboard',           icon: LayoutDashboard },
  { label: 'Customers',   href: '/dashboard/customers', icon: Users },
  { label: 'Reports',     href: '/dashboard/reports',   icon: BarChart2 },
  { label: "What's New",  href: '/dashboard/updates',   icon: Megaphone },
];

const paymentsItems = [
  { label: 'New Proposal & Invoice', href: '/dashboard/payments/new', icon: Plus },
  { label: 'Proposals',     href: '/dashboard/proposals',              icon: FileText },
  { label: 'Invoices',      href: '/dashboard/invoices/new',           icon: Receipt },
  // { label: 'Payment Links', href: '/dashboard/payments/payment-links', icon: Link2 }, // hidden
  { label: 'Subscriptions', href: '/dashboard/payments/subscriptions', icon: RefreshCw },
  // { label: 'Payouts', href: '/dashboard/payments/payouts', icon: DollarSign }, // hidden for now
];

const settingsItems = [
  { label: 'General',         href: '/dashboard/settings',                 icon: Settings },
  { label: 'Branding',        href: '/dashboard/settings/branding',        icon: Palette },
  { label: 'Email Templates', href: '/dashboard/settings/email-templates', icon: Mail },
  { label: 'Team',            href: '/dashboard/settings/team',            icon: UsersRound },
  { label: 'Notifications',   href: '/dashboard/settings/notifications',   icon: Bell },
];

export default function Sidebar({ venue }: SidebarProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isOnSettings = pathname.startsWith('/dashboard/settings');
  const isOnPayments = pathname.startsWith('/dashboard/payments')
    || pathname.startsWith('/dashboard/transactions')
    || pathname.startsWith('/dashboard/invoices')
    || pathname.startsWith('/dashboard/proposals')
    || pathname === '/dashboard/payments/new';

  const [settingsOpen, setSettingsOpen] = useState(isOnSettings);
  const [paymentsOpen, setPaymentsOpen] = useState(isOnPayments);

  useEffect(() => { if (isOnSettings) setSettingsOpen(true); }, [isOnSettings]);
  useEffect(() => { if (isOnPayments) setPaymentsOpen(true); }, [isOnPayments]);
  useEffect(() => { setMobileOpen(false); }, [pathname]);
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  // Only ONE item can be active at a time.
  // Priority: exact pathname match → prefix match → nothing.
  // If inside a collapsible group section, only sub-items are "active" (text-only), 
  // the parent group button gets the pill instead.
  const isActive = (href: string) => {
    // Exact match for home
    if (href === '/dashboard') return pathname === '/dashboard';
    // If we're inside Payments section, no top-level item is "active" — Payments parent gets the pill
    if (isOnPayments) return false;
    // If we're inside Settings section, no top-level item is "active" — Settings parent gets the pill
    if (isOnSettings) return false;
    return pathname.startsWith(href);
  };

  // Sub-item active: only when we're in that section and on that specific page
  const isSubActive = (href: string) => {
    if (href === '/dashboard/invoices/new') return pathname.startsWith('/dashboard/invoices');
    return pathname.startsWith(href);
  };

  const returnUrl = `https://login.storyvenuemarketing.com/v2/location/${venue.ghl_location_id}`;

  // ── Nav item styles ──────────────────────────────────────────────────────
  const navItem = (active: boolean) =>
    `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
      active ? 'text-white' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
    }`;

  const navItemStyle = (active: boolean): React.CSSProperties =>
    active ? { backgroundColor: '#1b1b1b' } : {};

  const subItem = (active: boolean) =>
    `flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
      active ? 'font-semibold' : 'text-gray-400 hover:text-gray-800'
    }`;

  const subItemStyle = (active: boolean): React.CSSProperties =>
    active ? { color: '#1b1b1b' } : {};

  const groupBtn = (active: boolean) =>
    `w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
      active ? 'text-white' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
    }`;

  const groupBtnStyle = (active: boolean): React.CSSProperties =>
    active ? { backgroundColor: '#1b1b1b', color: '#ffffff' } : {};

  // ── Shared nav content ───────────────────────────────────────────────────
  const NavContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo area */}
      <div className="px-4 pt-5 pb-2">
        <Link href="/dashboard" className="block">
          <Image src="/storyvenue-dark-logo.png" alt="StoryPay" width={148} height={38} className="opacity-90" />
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">

        {/* Main items */}
        {menuItems.map(item => {
          const Icon = item.icon;
          const active = isActive(item.href);
          const isAI = item.label === 'Ask AI' || item.label === 'Support';
          return (
            <Link
              key={item.label}
              href={isAI ? '#' : item.href}
              onClick={isAI ? (e) => { e.preventDefault(); window.dispatchEvent(new Event('open-ask-ai')); } : undefined}
              className={navItem(active && !isAI)}
              style={navItemStyle(active && !isAI)}
            >
              <Icon size={16} />
              <span>{item.label}</span>
            </Link>
          );
        })}

        {/* Payments collapsible */}
        <div>
          <button type="button" onClick={() => setPaymentsOpen(v => !v)} className={groupBtn(isOnPayments && paymentsOpen)} style={groupBtnStyle(isOnPayments && paymentsOpen)}>
            <div className="flex items-center gap-3">
              <CreditCard size={16} />
              <span>Payments</span>
            </div>
            <ChevronDown size={13} className={`transition-transform duration-200 ${paymentsOpen ? 'rotate-180' : ''} ${isOnPayments && paymentsOpen ? 'text-white/50' : 'text-gray-400'}`} />
          </button>
          {paymentsOpen && (
            <div className="mt-0.5 ml-3 pl-3 border-l border-gray-100 space-y-0.5 py-0.5">
              {paymentsItems.map(sub => {
                const SubIcon = sub.icon;
                const active = isSubActive(sub.href);
                return (
                  <Link key={sub.label} href={sub.href} className={subItem(active)} style={subItemStyle(active)}>
                    <SubIcon size={14} />
                    <span>{sub.label}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Products — hidden for now */}

        {/* Settings collapsible */}
        <div>
          <button type="button" onClick={() => setSettingsOpen(v => !v)} className={groupBtn(isOnSettings && settingsOpen)} style={groupBtnStyle(isOnSettings && settingsOpen)}>
            <div className="flex items-center gap-3">
              <Settings size={16} />
              <span>Settings</span>
            </div>
            <ChevronDown size={13} className={`transition-transform duration-200 ${settingsOpen ? 'rotate-180' : ''} ${isOnSettings && settingsOpen ? 'text-white/50' : 'text-gray-400'}`} />
          </button>
          {settingsOpen && (
            <div className="mt-0.5 ml-3 pl-3 border-l border-gray-100 space-y-0.5 py-0.5">
              {settingsItems.map(sub => {
                const SubIcon = sub.icon;
                const active = pathname === sub.href;
                return (
                  <Link key={sub.label} href={sub.href} className={subItem(active)} style={subItemStyle(active)}>
                    <SubIcon size={14} />
                    <span>{sub.label}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-gray-100">
        <button
          onClick={() => window.dispatchEvent(new Event('open-ask-ai'))}
          className="flex items-center gap-2 text-gray-400 hover:text-gray-700 transition-colors text-sm w-full"
        >
          <HelpCircle size={16} />
          <span>Support</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 h-14" style={{ backgroundColor: '#fafaf9', borderBottom: '1px solid #ebebeb' }}>
        <Image src="/storyvenue-dark-logo.png" alt="StoryPay" width={90} height={22} />
        <button onClick={() => setMobileOpen(v => !v)} className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 transition-colors">
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile backdrop */}
      {mobileOpen && <div className="lg:hidden fixed inset-0 z-40 bg-black/20" onClick={() => setMobileOpen(false)} />}

      {/* Mobile drawer */}
      <aside className={`lg:hidden fixed top-0 left-0 bottom-0 z-50 w-[280px] transition-transform duration-300 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`} style={{ backgroundColor: '#fafaf9', borderRight: '1px solid #ebebeb' }}>
        <NavContent />
      </aside>

      {/* Desktop sidebar */}
      <aside className="hidden lg:block fixed left-0 top-0 bottom-0 w-[260px]" style={{ backgroundColor: '#fafaf9', borderRight: '1px solid #ebebeb' }}>
        <NavContent />
      </aside>
    </>
  );
}
