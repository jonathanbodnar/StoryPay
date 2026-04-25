'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard, FileText, Users, CreditCard, BarChart2,
  Sparkles, Megaphone, Settings, Palette, Mail, UsersRound,
  Bell, Receipt, Link2, RefreshCw, Plus, Calendar,
  Menu, X, ChevronDown, ChevronLeft, ChevronRight,
  HelpCircle, LogOut, BookOpen, Store, Inbox, Share2, LayoutTemplate, MessageCircle,
  BarChart3, Workflow, Star,
  Images,
  BadgeCheck,
  Ticket,
  Package,
  UserCircle,
} from 'lucide-react';
import { classNames } from '@/lib/utils';

interface Venue { id: string; name: string; ghl_location_id: string; }
type UserRole = 'owner' | 'admin' | 'member';

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  navId: string;
};

interface SidebarProps {
  venue: Venue;
  role?: UserRole;
  memberName?: string | null;
  memberEmail?: string | null;
  /** Desktop-only narrow icon rail */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** From directory plan; null = show all nav targets. */
  allowedNavIds?: string[] | null;
}

const menuItems: NavItem[] = [
  { label: 'Ask AI', href: '/dashboard/ai', icon: Sparkles, navId: 'nav_main_ai' },
  { label: 'Home', href: '/dashboard', icon: LayoutDashboard, navId: 'nav_main_home' },
  { label: 'Contacts', href: '/dashboard/contacts', icon: Users, navId: 'nav_main_contacts' },
  { label: 'Conversations', href: '/dashboard/conversations', icon: MessageCircle, navId: 'nav_main_conversations' },
  { label: 'Calendar', href: '/dashboard/calendar', icon: Calendar, navId: 'nav_main_calendar' },
  { label: 'Leads', href: '/dashboard/leads', icon: Inbox, navId: 'nav_main_leads' },
  { label: 'Reports', href: '/dashboard/reports', icon: BarChart2, navId: 'nav_main_reports' },
  { label: "What's New", href: '/dashboard/updates', icon: Megaphone, navId: 'nav_main_updates' },
  { label: 'Help Center', href: '/dashboard/help', icon: BookOpen, navId: 'nav_main_help' },
];

const paymentsItems: NavItem[] = [
  { label: 'New', href: '/dashboard/payments/new', icon: Plus, navId: 'nav_payments_new' },
  { label: 'Packages', href: '/dashboard/offerings', icon: Package, navId: 'nav_offerings' },
  { label: 'Coupons', href: '/dashboard/payments/coupons', icon: Ticket, navId: 'nav_payments_coupons' },
  { label: 'Proposals', href: '/dashboard/payments/proposals', icon: FileText, navId: 'nav_payments_proposals' },
  { label: 'Proposal Templates', href: '/dashboard/proposals/templates', icon: Receipt, navId: 'nav_proposals_hub' },
  { label: 'Installments', href: '/dashboard/payments/installments', icon: Calendar, navId: 'nav_payments_installments' },
  { label: 'Subscriptions', href: '/dashboard/payments/subscriptions', icon: RefreshCw, navId: 'nav_payments_subscriptions' },
  { label: 'Transactions', href: '/dashboard/transactions', icon: CreditCard, navId: 'nav_transactions' },
];

const marketingItems: NavItem[] = [
  { label: 'Analytics',          href: '/dashboard/marketing/analytics',       icon: BarChart3,     navId: 'nav_marketing_analytics' },
  { label: 'Emails',             href: '/dashboard/marketing/email/campaigns', icon: Mail,          navId: 'nav_marketing_email_campaigns' },
  { label: 'Segments',           href: '/dashboard/marketing/email/segments',  icon: Users,         navId: 'nav_marketing_email_segments' },
  { label: 'Forms',              href: '/dashboard/marketing/form-builder',    icon: LayoutTemplate, navId: 'nav_marketing_form_builder' },
  { label: 'Workflows',          href: '/dashboard/marketing/workflows',        icon: Workflow,      navId: 'nav_marketing_email_automations' },
  { label: 'Trigger links & tags', href: '/dashboard/marketing/trigger-links', icon: Link2,         navId: 'nav_marketing_trigger_links' },
];

const settingsItems: NavItem[] = [
  { label: 'General', href: '/dashboard/settings', icon: Settings, navId: 'nav_settings_general' },
  { label: 'Branding', href: '/dashboard/settings/branding', icon: Palette, navId: 'nav_settings_branding' },
  { label: 'Email Templates', href: '/dashboard/settings/email-templates', icon: Mail, navId: 'nav_settings_email_templates' },
  { label: 'Integrations', href: '/dashboard/settings/integrations', icon: Link2, navId: 'nav_settings_integrations' },
  { label: 'Team', href: '/dashboard/settings/team', icon: UsersRound, navId: 'nav_settings_team' },
  { label: 'Notifications', href: '/dashboard/settings/notifications', icon: Bell, navId: 'nav_settings_notifications' },
];

const listingItems: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard/listing', icon: LayoutDashboard, navId: 'nav_listing_dashboard' },
  { label: 'Plans & billing', href: '/dashboard/directory-billing', icon: CreditCard, navId: 'nav_listing_directory_billing' },
  { label: 'Media library', href: '/dashboard/listing/media', icon: Images, navId: 'nav_listing_media' },
  { label: 'Analytics', href: '/dashboard/listing/analytics', icon: BarChart3, navId: 'nav_listing_analytics' },
  { label: 'Reviews', href: '/dashboard/listing/reviews', icon: Star, navId: 'nav_listing_reviews' },
  { label: 'Verified & Sponsored', href: '/dashboard/listing/directory', icon: BadgeCheck, navId: 'nav_listing_directory' },
];

type FlyoutGroup = 'payments' | 'marketing' | 'settings' | 'listing' | null;

export default function Sidebar({
  venue: _venue,
  role = 'owner',
  memberName,
  memberEmail: _memberEmail,
  collapsed = false,
  onToggleCollapsed,
  allowedNavIds = null,
}: SidebarProps) {
  const isOwner = role === 'owner';
  const isAdmin = role === 'owner' || role === 'admin';
  const pathname = usePathname();
  const navOk = (navId: string) => allowedNavIds === null || allowedNavIds.includes(navId);
  const isOnListing = pathname.startsWith('/dashboard/listing');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [flyout, setFlyout] = useState<FlyoutGroup>(null);
  const [flyoutPos, setFlyoutPos] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const [convUnread, setConvUnread] = useState(0);
  const [updatesUnread, setUpdatesUnread] = useState(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  const refreshConvUnread = useCallback(() => {
    void fetch('/api/conversations/unread-count')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { count?: number } | null) => {
        if (d && typeof d.count === 'number') setConvUnread(d.count);
      })
      .catch(() => {});
  }, []);

  const refreshUpdatesUnread = useCallback(() => {
    void fetch('/api/changelog/unread-count')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { count?: number } | null) => {
        if (d && typeof d.count === 'number') setUpdatesUnread(d.count);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshConvUnread();
    const t = setInterval(refreshConvUnread, 45000);
    const onEvt = () => refreshConvUnread();
    window.addEventListener('storypay:conversations-unread', onEvt);
    return () => {
      clearInterval(t);
      window.removeEventListener('storypay:conversations-unread', onEvt);
    };
  }, [refreshConvUnread]);

  useEffect(() => {
    refreshUpdatesUnread();
    const t = setInterval(refreshUpdatesUnread, 5 * 60 * 1000);
    const onSeen = () => setUpdatesUnread(0);
    window.addEventListener('storypay:updates-seen', onSeen);
    return () => {
      clearInterval(t);
      window.removeEventListener('storypay:updates-seen', onSeen);
    };
  }, [refreshUpdatesUnread]);

  useEffect(() => {
    if (pathname.startsWith('/dashboard/conversations')) refreshConvUnread();
  }, [pathname, refreshConvUnread]);

  useEffect(() => {
    if (pathname.startsWith('/dashboard/updates')) setUpdatesUnread(0);
  }, [pathname]);

  const isOnSettings = pathname.startsWith('/dashboard/settings');
  const isOnMarketing = pathname.startsWith('/dashboard/marketing');
  const isOnPayments = pathname.startsWith('/dashboard/payments')
    || pathname.startsWith('/dashboard/transactions')
    || pathname.startsWith('/dashboard/invoices')
    || pathname.startsWith('/dashboard/proposals');

  type OpenGroup = 'payments' | 'settings' | 'marketing' | 'listing' | null;
  const initialGroup: OpenGroup = isOnListing
    ? 'listing'
    : isOnPayments
      ? 'payments'
      : isOnSettings
        ? 'settings'
        : isOnMarketing
          ? 'marketing'
          : null;
  const [openGroup, setOpenGroup] = useState<OpenGroup>(initialGroup);

  const paymentsOpen = openGroup === 'payments';
  const settingsOpen = openGroup === 'settings';
  const marketingOpen = openGroup === 'marketing';
  const listingOpen = openGroup === 'listing';

  useEffect(() => {
    if (isOnListing) setOpenGroup('listing');
    else if (isOnMarketing) setOpenGroup('marketing');
    else if (isOnPayments) setOpenGroup('payments');
    else if (isOnSettings) setOpenGroup('settings');
    else setOpenGroup(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  function listingSubActive(subHref: string) {
    if (subHref === '/dashboard/listing') {
      return pathname === '/dashboard/listing' || pathname === '/dashboard/listing/';
    }
    return pathname.startsWith(subHref);
  }

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
    if (isOnListing) return false;
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
    if (!navOk(sub.navId)) return false;
    if (!isOwner && sub.label === 'General') return false;
    if (!isOwner && sub.label === 'Team') return false;
    if (!isOwner && sub.label === 'Integrations') return false;
    return true;
  });

  const listingFiltered = listingItems.filter((sub) => navOk(sub.navId));
  const paymentsFiltered = paymentsItems.filter((sub) => navOk(sub.navId));
  const marketingFiltered = marketingItems.filter((sub) => navOk(sub.navId));

  const NavContent = ({ rail, onCloseMobile }: { rail: boolean; onCloseMobile?: () => void }) => (
    <div className="flex flex-col h-full">
      <div className={`px-3 pt-5 pb-2 ${rail ? 'flex flex-col items-center gap-2' : ''}`}>
        <div className={`flex items-center w-full ${rail ? 'flex-col gap-2' : 'justify-between gap-2'}`}>
          <Link
            href="/dashboard"
            className={rail ? 'flex justify-center' : 'block min-w-0'}
            onClick={onCloseMobile}
          >
            {rail ? (
              <Image
                src="/storyvenue-sidebar-mark.png"
                alt="StoryPay"
                width={40}
                height={40}
                className="object-contain opacity-90"
                priority
              />
            ) : (
              <Image
                src="/storyvenue-dark-logo.png"
                alt="StoryPay"
                width={148}
                height={38}
                className="opacity-90"
              />
            )}
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

      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {menuItems.filter((item) => {
          if (!navOk(item.navId)) return false;
          if (!isAdmin && item.label === 'Reports') return false;
          if (!isAdmin && item.label === "What's New") return false;
          return true;
        }).map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          const isAI = item.label === 'Ask AI' || item.label === 'Support';
          const isHelpCenter = item.label === 'Help Center';
          const isConversations = item.href === '/dashboard/conversations';
          const isUpdates = item.href === '/dashboard/updates';
          const showConvBadge = isConversations && convUnread > 0;
          const showUpdatesBadge = isUpdates && updatesUnread > 0;
          const badgeCount = showConvBadge
            ? convUnread
            : showUpdatesBadge
              ? updatesUnread
              : 0;
          const showBadge = showConvBadge || showUpdatesBadge;
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
              title={
                rail
                  ? showBadge
                    ? `${item.label} (${badgeCount} unread)`
                    : item.label
                  : undefined
              }
              className={classNames(
                navItem(active && !isAI, rail),
                !rail && (isConversations || isUpdates) ? 'w-full' : '',
              )}
              style={navItemStyle(active && !isAI)}
            >
              <span className={rail && showBadge ? 'relative inline-flex' : 'inline-flex'}>
                <Icon size={16} className="shrink-0" />
                {rail && showBadge ? (
                  <span className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />
                ) : null}
              </span>
              {!rail && (
                <>
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {showBadge ? (
                    <span className="ml-auto shrink-0 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold leading-none text-white tabular-nums">
                      {badgeCount > 99 ? '99+' : badgeCount}
                    </span>
                  ) : null}
                </>
              )}
            </Link>
          );
        })}

        {listingFiltered.length > 0 ? (
        <div>
          {rail ? (
            <button
              type="button"
              title="Venue listing"
              onClick={(e) => openFlyout('listing', e.currentTarget)}
              className={groupBtn(isOnListing || flyout === 'listing', true)}
              style={groupBtnStyle(isOnListing || flyout === 'listing')}
            >
              <Store size={16} />
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => toggleGroup('listing')}
                className={groupBtn(isOnListing && listingOpen, false)}
                style={groupBtnStyle(isOnListing && listingOpen)}
              >
                <div className="flex items-center gap-3">
                  <Store size={16} />
                  <span>Venue listing</span>
                </div>
                <ChevronDown
                  size={13}
                  className={`transition-transform duration-200 ${listingOpen ? 'rotate-180' : ''} ${
                    isOnListing && listingOpen ? 'text-white/50' : 'text-gray-400'
                  }`}
                />
              </button>
              {listingOpen && (
                <div className="mt-0.5 ml-2 pl-2 space-y-0.5 py-0.5">
                  {listingFiltered.map((sub) => {
                    const SubIcon = sub.icon;
                    const active = listingSubActive(sub.href);
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
        ) : null}

        {paymentsFiltered.length > 0 ? (
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
                <div className="mt-0.5 ml-2 pl-2 space-y-0.5 py-0.5">
                  {paymentsFiltered.map((sub) => {
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
        ) : null}

        {isAdmin && marketingFiltered.length > 0 ? (
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
                  <div className="mt-0.5 ml-2 pl-2 space-y-0.5 py-0.5">
                    {marketingFiltered.map((sub) => {
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
        ) : null}

        {isAdmin && settingsFiltered.length > 0 ? (
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
                  <div className="mt-0.5 ml-2 pl-2 space-y-0.5 py-0.5">
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
        ) : null}
      </nav>

      <div className={`px-3 py-4 border-t border-gray-200 space-y-1 ${rail ? 'flex flex-col items-center' : ''}`}>
        {/* My Profile — visible to all users */}
        <Link
          href="/dashboard/profile"
          title={rail ? 'My Profile' : undefined}
          className={`flex items-center gap-2 transition-colors text-sm w-full rounded-lg hover:bg-gray-50 ${
            pathname === '/dashboard/profile'
              ? 'bg-gray-100 text-gray-900 font-semibold'
              : 'text-gray-600 hover:text-gray-900'
          } ${rail ? 'justify-center px-2 py-2' : 'px-2 py-1.5'}`}
        >
          {memberName ? (
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-700 text-[9px] font-bold text-white flex-shrink-0">
              {memberName.charAt(0).toUpperCase()}
            </div>
          ) : (
            <UserCircle size={16} className="flex-shrink-0" />
          )}
          {!rail && <span className="truncate">{memberName ?? 'My Profile'}</span>}
        </Link>
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
    items: NavItem[],
    group: NonNullable<FlyoutGroup>,
  ) => {
    if (!flyout || flyout !== group || !flyoutPos || !collapsed) return null;
    const node = (
      <div
        className="hidden lg:block fixed z-[100] w-56 rounded-xl border border-gray-200 bg-white py-1"
        style={{ top: flyoutPos.top, left: flyoutPos.left }}
        role="menu"
      >
        {items.map((sub) => {
          const SubIcon = sub.icon;
          const active =
            group === 'settings'
              ? pathname === sub.href
              : group === 'listing'
                ? listingSubActive(sub.href)
                : isSubActive(sub.href);
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
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 h-14" style={{ backgroundColor: '#fafaf9', boxShadow: '0 4px 16px -2px rgba(0,0,0,0.07)' }}>
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
        style={{ backgroundColor: '#fafaf9', boxShadow: '6px 0 24px -4px rgba(0,0,0,0.07)' }}
      >
        <NavContent rail={false} onCloseMobile={() => setMobileOpen(false)} />
      </aside>

      <aside
        className={`hidden lg:block fixed left-0 top-0 bottom-0 z-30 transition-[width] duration-200 ease-out ${
          collapsed ? 'w-[60px]' : 'w-[216px]'
        }`}
        style={{ backgroundColor: '#fafaf9', boxShadow: '6px 0 24px -4px rgba(0,0,0,0.07)' }}
      >
        <NavContent rail={collapsed} />
      </aside>

      {flyoutBackdrop}
      {flyoutPanel(listingFiltered, 'listing')}
      {flyoutPanel(paymentsFiltered, 'payments')}
      {flyoutPanel(marketingFiltered, 'marketing')}
      {flyoutPanel(settingsFiltered, 'settings')}
    </>
  );
}
