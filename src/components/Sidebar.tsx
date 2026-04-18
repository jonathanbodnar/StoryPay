'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  LayoutDashboard, FileText, Users, CreditCard, BarChart2,
  Sparkles, Megaphone, Settings, Palette, Mail, UsersRound,
  Bell, Receipt, Link2, RefreshCw, Plus, Calendar,
  Menu, X, ChevronDown, ChevronLeft, ChevronRight,
  HelpCircle, LogOut, BookOpen, Store, Inbox, Share2, LayoutTemplate,
} from 'lucide-react';

interface Venue { id: string; name: string; ghl_location_id: string; }
type UserRole = 'owner' | 'admin' | 'member';
interface SidebarProps {
  venue: Venue;
  role?: UserRole;
  memberName?: string | null;
  memberEmail?: string | null;
  /** Desktop-only narrow icon rail */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

const menuItems = [
  { label: 'Ask AI', href: '/dashboard/ai', icon: Sparkles },
  { label: 'Home', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Customers', href: '/dashboard/customers', icon: Users },
  { label: 'Calendar', href: '/dashboard/calendar', icon: Calendar },
  { label: 'Directory Listing', href: '/dashboard/listing', icon: Store },
  { label: 'Leads', href: '/dashboard/leads', icon: Inbox },
  { label: 'Reports', href: '/dashboard/reports', icon: BarChart2 },
  { label: "What's New", href: '/dashboard/updates', icon: Megaphone },
  { label: 'Help Center', href: '/dashboard/help', icon: BookOpen },
];

const paymentsItems = [
  { label: 'New', href: '/dashboard/payments/new', icon: Plus },
  { label: 'Proposals', href: '/dashboard/payments/proposals', icon: FileText },
  { label: 'Proposal Templates', href: '/dashboard/proposals/templates', icon: Receipt },
  { label: 'Installments', href: '/dashboard/payments/installments', icon: Calendar },
  { label: 'Subscriptions', href: '/dashboard/payments/subscriptions', icon: RefreshCw },
  { label: 'Transactions', href: '/dashboard/transactions', icon: CreditCard },
];

const marketingItems = [
  { label: 'Email & campaigns', href: '/dashboard/marketing/email', icon: Mail },
  { label: 'Trigger Links & Tags', href: '/dashboard/marketing/trigger-links', icon: Link2 },
  { label: 'Form builder', href: '/dashboard/marketing/form-builder', icon: LayoutTemplate },
];

const settingsItems = [
  { label: 'General', href: '/dashboard/settings', icon: Settings },
  { label: 'Branding', href: '/dashboard/settings/branding', icon: Palette },
  { label: 'Email Templates', href: '/dashboard/settings/email-templates', icon: Mail },
  { label: 'Integrations', href: '/dashboard/settings/integrations', icon: Link2 },
  { label: 'Team', href: '/dashboard/settings/team', icon: UsersRound },
  { label: 'Notifications', href: '/dashboard/settings/notifications', icon: Bell },
];

type FlyoutGroup = 'payments' | 'marketing' | 'settings' | null;

export default function Sidebar({
  venue: _venue,
  role = 'owner',
  memberName,
  memberEmail: _memberEmail,
  collapsed = false,
  onToggleCollapsed,
}: SidebarProps) {
  const isOwner = role === 'owner';
  const isAdmin = role === 'owner' || role === 'admin';
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [flyout, setFlyout] = useState<FlyoutGroup>(null);
  const [flyoutPos, setFlyoutPos] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isOnSettings = pathname.startsWith('/dashboard/settings');
  const isOnMarketing = pathname.startsWith('/dashboard/marketing');
  const isOnPayments = pathname.startsWith('/dashboard/payments')
    || pathname.startsWith('/dashboard/transactions')
    || pathname.startsWith('/dashboard/invoices')
    || pathname.startsWith('/dashboard/proposals');

  type OpenGroup = 'payments' | 'settings' | 'marketing' | null;
  const initialGroup: OpenGroup = isOnPayments ? 'payments' : isOnSettings ? 'settings' : isOnMarketing ? 'marketing' : null;
  const [openGroup, setOpenGroup] = useState<OpenGroup>(initialGroup);

  const paymentsOpen = openGroup === 'payments';
  const settingsOpen = openGroup === 'settings';
  const marketingOpen = openGroup === 'marketing';

  useEffect(() => {
    if (isOnMarketing) setOpenGroup('marketing');
    else if (isOnPayments) setOpenGroup('payments');
    else if (isOnSettings) setOpenGroup('settings');
    else setOpenGroup(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    setFlyout(null);
    setFlyoutPos(null);
  }, [pathname]);

  useEffect(() => {
    if (!collapsed) {
      setFlyout(null);
      setFlyoutPos(null);
    }
  }, [collapsed]);

  const toggleGroup = (group: Exclude<OpenGroup, null>) =>
    setOpenGroup((curr) => (curr === group ? null : group));

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  const openFlyout = useCallback((group: Exclude<FlyoutGroup, null>, el: HTMLButtonElement) => {
    setFlyout((prev) => {
      if (prev === group) {
        setFlyoutPos(null);
        return null;
      }
      const r = el.getBoundingClientRect();
      setFlyoutPos({ top: Math.max(8, r.top), left: r.right + 8 });
      return group;
    });
  }, []);

  const isActive = (href: string) => {
    if (href === '/dashboard') return pathname === '/dashboard';
    if (isOnPayments) return false;
    if (isOnSettings) return false;
    if (isOnMarketing) return false;
    return pathname.startsWith(href);
  };

  const isSubActive = (href: string) => {
    if (href === '/dashboard/invoices/new') return pathname.startsWith('/dashboard/invoices');
    return pathname.startsWith(href);
  };

  const navItem = (active: boolean, rail: boolean) =>
    `flex items-center gap-3 rounded-xl text-sm font-medium transition-colors ${
      rail ? 'justify-center px-2 py-2.5' : 'px-3 py-2.5'
    } ${active ? 'text-white' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'}`;

  const navItemStyle = (active: boolean): React.CSSProperties =>
    active ? { backgroundColor: '#1b1b1b' } : {};

  const subItem = (active: boolean) =>
    `flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
      active ? 'font-semibold' : 'text-gray-400 hover:text-gray-800'
    }`;

  const subItemStyle = (active: boolean): React.CSSProperties =>
    active ? { color: '#1b1b1b' } : {};

  const groupBtn = (active: boolean, rail: boolean) =>
    `w-full flex items-center rounded-xl text-sm font-medium transition-colors ${
      rail ? 'justify-center px-2 py-2.5' : 'justify-between px-3 py-2.5'
    } ${active ? 'text-white' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'}`;

  const groupBtnStyle = (active: boolean): React.CSSProperties =>
    active ? { backgroundColor: '#1b1b1b', color: '#ffffff' } : {};

  const settingsFiltered = settingsItems.filter((sub) => {
    if (!isOwner && sub.label === 'General') return false;
    if (!isOwner && sub.label === 'Team') return false;
    if (!isOwner && sub.label === 'Integrations') return false;
    return true;
  });

  const NavContent = ({ rail, onCloseMobile }: { rail: boolean; onCloseMobile?: () => void }) => (
    <div className="flex flex-col h-full">
      <div className={`px-3 pt-5 pb-2 ${rail ? 'flex flex-col items-center gap-2' : ''}`}>
        <div className={`flex items-center w-full ${rail ? 'flex-col gap-2' : 'justify-between gap-2'}`}>
          <Link
            href="/dashboard"
            className={rail ? 'flex justify-center' : 'block min-w-0'}
            onClick={onCloseMobile}
          >
            <Image
              src="/storyvenue-dark-logo.png"
              alt="StoryPay"
              width={rail ? 40 : 148}
              height={rail ? 40 : 38}
              className={`opacity-90 ${rail ? 'object-contain max-h-10' : ''}`}
            />
          </Link>
          {!rail && onToggleCollapsed && (
            <button
              type="button"
              onClick={onToggleCollapsed}
              className="hidden lg:flex shrink-0 rounded-lg p-2 text-gray-500 hover:bg-gray-200/80 hover:text-gray-900"
              title="Collapse sidebar"
            >
              <ChevronLeft size={20} />
            </button>
          )}
        </div>
        {rail && onToggleCollapsed && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="hidden lg:flex rounded-lg p-2 text-gray-500 hover:bg-gray-200/80 hover:text-gray-900"
            title="Expand sidebar"
          >
            <ChevronRight size={20} />
          </button>
        )}
      </div>

      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
        {menuItems.filter((item) => {
          if (!isAdmin && item.label === 'Reports') return false;
          if (!isAdmin && item.label === "What's New") return false;
          return true;
        }).map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          const isAI = item.label === 'Ask AI' || item.label === 'Support';
          const isHelpCenter = item.label === 'Help Center';
          return (
            <Link
              key={item.label}
              href={isAI ? '#' : isHelpCenter ? '/dashboard/help?reset=1' : item.href}
              onClick={
                isAI
                  ? (e) => {
                    e.preventDefault();
                    window.dispatchEvent(new Event('open-ask-ai'));
                    onCloseMobile?.();
                  }
                  : () => onCloseMobile?.()
              }
              title={rail ? item.label : undefined}
              className={navItem(active && !isAI, rail)}
              style={navItemStyle(active && !isAI)}
            >
              <Icon size={16} className="shrink-0" />
              {!rail && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}

        <div>
          {rail ? (
            <button
              type="button"
              title="Payments"
              onClick={(e) => openFlyout('payments', e.currentTarget)}
              className={groupBtn(isOnPayments || flyout === 'payments', true)}
              style={groupBtnStyle(isOnPayments || flyout === 'payments')}
            >
              <CreditCard size={16} />
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => toggleGroup('payments')}
                className={groupBtn(isOnPayments && paymentsOpen, false)}
                style={groupBtnStyle(isOnPayments && paymentsOpen)}
              >
                <div className="flex items-center gap-3">
                  <CreditCard size={16} />
                  <span>Payments</span>
                </div>
                <ChevronDown
                  size={13}
                  className={`transition-transform duration-200 ${paymentsOpen ? 'rotate-180' : ''} ${
                    isOnPayments && paymentsOpen ? 'text-white/50' : 'text-gray-400'
                  }`}
                />
              </button>
              {paymentsOpen && (
                <div className="mt-0.5 ml-3 pl-3 border-l border-gray-200 space-y-0.5 py-0.5">
                  {paymentsItems.map((sub) => {
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
            </>
          )}
        </div>

        {isAdmin && (
          <div>
            {rail ? (
              <button
                type="button"
                title="Marketing"
                onClick={(e) => openFlyout('marketing', e.currentTarget)}
                className={groupBtn(isOnMarketing || flyout === 'marketing', true)}
                style={groupBtnStyle(isOnMarketing || flyout === 'marketing')}
              >
                <Share2 size={16} />
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => toggleGroup('marketing')}
                  className={groupBtn(isOnMarketing && marketingOpen, false)}
                  style={groupBtnStyle(isOnMarketing && marketingOpen)}
                >
                  <div className="flex items-center gap-3">
                    <Share2 size={16} />
                    <span>Marketing</span>
                  </div>
                  <ChevronDown
                    size={13}
                    className={`transition-transform duration-200 ${marketingOpen ? 'rotate-180' : ''} ${
                      isOnMarketing && marketingOpen ? 'text-white/50' : 'text-gray-400'
                    }`}
                  />
                </button>
                {marketingOpen && (
                  <div className="mt-0.5 ml-3 pl-3 border-l border-gray-200 space-y-0.5 py-0.5">
                    {marketingItems.map((sub) => {
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
              </>
            )}
          </div>
        )}

        {isAdmin && (
          <div>
            {rail ? (
              <button
                type="button"
                title="Settings"
                onClick={(e) => openFlyout('settings', e.currentTarget)}
                className={groupBtn(isOnSettings || flyout === 'settings', true)}
                style={groupBtnStyle(isOnSettings || flyout === 'settings')}
              >
                <Settings size={16} />
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => toggleGroup('settings')}
                  className={groupBtn(isOnSettings && settingsOpen, false)}
                  style={groupBtnStyle(isOnSettings && settingsOpen)}
                >
                  <div className="flex items-center gap-3">
                    <Settings size={16} />
                    <span>Settings</span>
                  </div>
                  <ChevronDown
                    size={13}
                    className={`transition-transform duration-200 ${settingsOpen ? 'rotate-180' : ''} ${
                      isOnSettings && settingsOpen ? 'text-white/50' : 'text-gray-400'
                    }`}
                  />
                </button>
                {settingsOpen && (
                  <div className="mt-0.5 ml-3 pl-3 border-l border-gray-200 space-y-0.5 py-0.5">
                    {settingsFiltered.map((sub) => {
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
              </>
            )}
          </div>
        )}
      </nav>

      <div className={`px-3 py-4 border-t border-gray-200 space-y-1 ${rail ? 'flex flex-col items-center' : ''}`}>
        {memberName && (
          <Link
            href="/dashboard/profile"
            title={rail ? memberName : undefined}
            className={`flex items-center gap-2 text-gray-700 hover:text-gray-900 transition-colors text-sm w-full rounded-lg hover:bg-gray-50 ${
              rail ? 'justify-center px-2 py-2' : 'px-2 py-1.5'
            }`}
          >
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-[10px] font-bold text-gray-600 flex-shrink-0">
              {memberName.charAt(0).toUpperCase()}
            </div>
            {!rail && <span className="truncate">{memberName}</span>}
          </Link>
        )}
        <button
          type="button"
          title="Support"
          onClick={() => window.dispatchEvent(new Event('open-ask-ai'))}
          className={`flex items-center gap-2 text-gray-400 hover:text-gray-700 transition-colors text-sm w-full rounded-lg hover:bg-gray-50 ${
            rail ? 'justify-center px-2 py-2' : 'px-2 py-1.5'
          }`}
        >
          <HelpCircle size={16} />
          {!rail && <span>Support</span>}
        </button>
        <a
          href="/api/auth/logout"
          title="Logout"
          className={`flex items-center gap-2 text-gray-400 hover:text-gray-700 transition-colors text-sm w-full rounded-lg hover:bg-gray-50 ${
            rail ? 'justify-center px-2 py-2' : 'px-2 py-1.5'
          }`}
        >
          <LogOut size={16} />
          {!rail && <span>Logout</span>}
        </a>
      </div>
    </div>
  );

  const flyoutPanel = (
    items: typeof paymentsItems | typeof marketingItems | typeof settingsItems,
    group: NonNullable<FlyoutGroup>,
  ) => {
    if (!flyout || flyout !== group || !flyoutPos || !collapsed) return null;
    const node = (
      <div
        className="hidden lg:block fixed z-[100] w-56 rounded-xl border border-gray-200 bg-white py-1 shadow-xl"
        style={{ top: flyoutPos.top, left: flyoutPos.left }}
        role="menu"
      >
        {items.map((sub) => {
          const SubIcon = sub.icon;
          const active = group === 'settings' ? pathname === sub.href : isSubActive(sub.href);
          return (
            <Link
              key={sub.label}
              href={sub.href}
              className={`flex items-center gap-2 px-3 py-2 text-sm ${active ? 'font-semibold text-gray-900 bg-gray-50' : 'text-gray-600 hover:bg-gray-50'}`}
              onClick={() => {
                setFlyout(null);
                setFlyoutPos(null);
              }}
            >
              <SubIcon size={14} />
              {sub.label}
            </Link>
          );
        })}
      </div>
    );
    return mounted ? createPortal(node, document.body) : null;
  };

  const flyoutBackdrop =
    collapsed && flyout && mounted ? (
      createPortal(
        <div
          className="hidden lg:block fixed inset-0 z-[90] bg-black/10"
          aria-hidden
          onClick={() => {
            setFlyout(null);
            setFlyoutPos(null);
          }}
        />,
        document.body,
      )
    ) : null;

  return (
    <>
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 h-14" style={{ backgroundColor: '#fafaf9', borderBottom: '1px solid #e5e7eb' }}>
        <Link href="/dashboard">
          <Image src="/storyvenue-dark-logo.png" alt="StoryPay" width={90} height={22} />
        </Link>
        <div className="flex items-center gap-2">
          <a
            href="/api/auth/logout"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            title="Logout"
          >
            <LogOut size={17} />
          </a>
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/20"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={`lg:hidden fixed top-0 left-0 bottom-0 z-50 w-[280px] transition-transform duration-300 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ backgroundColor: '#fafaf9', borderRight: '1px solid #e5e7eb' }}
      >
        <NavContent rail={false} onCloseMobile={() => setMobileOpen(false)} />
      </aside>

      <aside
        className={`hidden lg:block fixed left-0 top-0 bottom-0 z-30 transition-[width] duration-200 ease-out ${
          collapsed ? 'w-[72px]' : 'w-[260px]'
        }`}
        style={{ backgroundColor: '#fafaf9', borderRight: '1px solid #e5e7eb' }}
      >
        <NavContent rail={collapsed} />
      </aside>

      {flyoutBackdrop}
      {flyoutPanel(paymentsItems, 'payments')}
      {flyoutPanel(marketingItems, 'marketing')}
      {flyoutPanel(settingsFiltered, 'settings')}
    </>
  );
}
