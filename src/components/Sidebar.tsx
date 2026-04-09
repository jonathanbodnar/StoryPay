'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import {
  LayoutDashboard, FileText, Users, CreditCard, BarChart2,
  Sparkles, Megaphone, Settings, Palette, Mail, UsersRound,
  Bell, Package, Receipt, Link2, RefreshCw, DollarSign,
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
  { label: 'Support',     href: '/dashboard/support',   icon: HelpCircle },
];

const paymentsItems = [
  { label: 'Proposals',     href: '/dashboard/proposals',              icon: FileText },
  { label: 'Invoices',      href: '/dashboard/invoices/new',           icon: Receipt },
  { label: 'Payment Links', href: '/dashboard/payments/payment-links', icon: Link2 },
  { label: 'Transactions',  href: '/dashboard/transactions',           icon: CreditCard },
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
    || pathname.startsWith('/dashboard/proposals');

  const [settingsOpen, setSettingsOpen] = useState(isOnSettings);
  const [paymentsOpen, setPaymentsOpen] = useState(isOnPayments);

  useEffect(() => { if (isOnSettings) setSettingsOpen(true); }, [isOnSettings]);
  useEffect(() => { if (isOnPayments) setPaymentsOpen(true); }, [isOnPayments]);
  useEffect(() => { setMobileOpen(false); }, [pathname]);
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  const isActive = (href: string) => {
    if (href === '/dashboard') return pathname === '/dashboard';
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
          <Image src="/storyvenue-dark-logo.png" alt="StoryPay" width={110} height={28} className="opacity-90" />
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
          <button type="button" onClick={() => setPaymentsOpen(v => !v)} className={groupBtn(paymentsOpen)} style={groupBtnStyle(paymentsOpen)}>
            <div className="flex items-center gap-3">
              <CreditCard size={16} />
              <span>Payments</span>
            </div>
            <ChevronDown size={13} className={`transition-transform duration-200 ${paymentsOpen ? 'rotate-180 text-white/50' : 'text-gray-400'}`} />
          </button>
          {paymentsOpen && (
            <div className="mt-0.5 ml-3 pl-3 border-l border-gray-100 space-y-0.5 py-0.5">
              {paymentsItems.map(sub => {
                const SubIcon = sub.icon;
                const active = isActive(sub.href);
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

        {/* Products */}
        {(() => {
          const active = isActive('/dashboard/products');
          return (
            <Link href="/dashboard/products" className={navItem(active)} style={navItemStyle(active)}>
              <Package size={16} />
              <span>Products</span>
            </Link>
          );
        })()}

        {/* Settings collapsible */}
        <div>
          <button type="button" onClick={() => setSettingsOpen(v => !v)} className={groupBtn(settingsOpen)} style={groupBtnStyle(settingsOpen)}>
            <div className="flex items-center gap-3">
              <Settings size={16} />
              <span>Settings</span>
            </div>
            <ChevronDown size={13} className={`transition-transform duration-200 ${settingsOpen ? 'rotate-180 text-white/50' : 'text-gray-400'}`} />
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
        <p className="text-xs font-medium text-gray-700 truncate">{venue.name}</p>
        <p className="text-[10px] text-gray-400 mt-0.5">&copy; StoryVenue 2026</p>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 h-14 border-b border-gray-100" style={{ backgroundColor: '#fafaf9' }}>
        <Image src="/storyvenue-dark-logo.png" alt="StoryPay" width={90} height={22} />
        <button onClick={() => setMobileOpen(v => !v)} className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 transition-colors">
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile backdrop */}
      {mobileOpen && <div className="lg:hidden fixed inset-0 z-40 bg-black/20" onClick={() => setMobileOpen(false)} />}

      {/* Mobile drawer */}
      <aside className={`lg:hidden fixed top-0 left-0 bottom-0 z-50 w-[240px] border-r border-gray-100 transition-transform duration-300 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`} style={{ backgroundColor: '#fafaf9' }}>
        <NavContent />
      </aside>

      {/* Desktop sidebar */}
      <aside className="hidden lg:block fixed left-0 top-0 bottom-0 w-[220px] border-r border-gray-100" style={{ backgroundColor: '#fafaf9' }}>
        <NavContent />
      </aside>
    </>
  );
}
