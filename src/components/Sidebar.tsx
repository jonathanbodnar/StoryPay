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
  Zap,
  Lock,
} from 'lucide-react';
import { classNames } from '@/lib/utils';
import LunarPayOnboarding from '@/components/settings/LunarPayOnboarding';
import { LockedFeatureModal } from '@/components/LockedFeatureView';

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
  /** True when the venue is on a manually-billed legacy plan. */
  isLegacyPlan?: boolean;
}

const menuItems: NavItem[] = [
  { label: 'Ask AI', href: '/dashboard/ai', icon: Sparkles, navId: 'nav_main_ai' },
  { label: 'Home', href: '/dashboard', icon: LayoutDashboard, navId: 'nav_main_home' },
  { label: 'Contacts', href: '/dashboard/contacts', icon: Users, navId: 'nav_main_contacts' },
  { label: 'Conversations', href: '/dashboard/conversations', icon: MessageCircle, navId: 'nav_main_conversations' },
  { label: 'Calendar', href: '/dashboard/calendar', icon: Calendar, navId: 'nav_main_calendar' },
  { label: 'Leads', href: '/dashboard/leads', icon: Inbox, navId: 'nav_main_leads' },
  { label: 'Media', href: '/dashboard/media', icon: Images, navId: 'nav_main_media' },
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
  { label: 'Notifications', href: '/dashboard/settings/notifications', icon: Bell, navId: 'nav_settings_notifications' },
  { label: 'Settings', href: '/dashboard/payments/settings', icon: Settings, navId: 'nav_payments_settings' },
];

const marketingItems: NavItem[] = [
  { label: 'Analytics',          href: '/dashboard/marketing/analytics',          icon: BarChart3,      navId: 'nav_marketing_analytics' },
  { label: 'Emails',             href: '/dashboard/marketing/email/campaigns',    icon: Mail,           navId: 'nav_marketing_email_campaigns' },
  { label: 'Audiences',          href: '/dashboard/marketing/email/audiences',    icon: Users,          navId: 'nav_marketing_email_segments' },
  { label: 'Forms',              href: '/dashboard/marketing/form-builder',       icon: LayoutTemplate, navId: 'nav_marketing_form_builder' },
  { label: 'Workflows',          href: '/dashboard/marketing/workflows',           icon: Workflow,       navId: 'nav_marketing_email_automations' },
  { label: 'Trigger links & tags', href: '/dashboard/marketing/trigger-links',   icon: Link2,          navId: 'nav_marketing_trigger_links' },
  { label: 'AI Concierge',       href: '/dashboard/marketing/ai-concierge',       icon: Sparkles,       navId: 'nav_marketing_ai_concierge' },
  { label: 'Email settings',     href: '/dashboard/marketing/email/settings',     icon: Settings,       navId: 'nav_marketing_email_settings' },
];

const settingsItems: NavItem[] = [
  { label: 'General', href: '/dashboard/settings', icon: Settings, navId: 'nav_settings_general' },
  { label: 'Branding', href: '/dashboard/settings/branding', icon: Palette, navId: 'nav_settings_branding' },
  { label: 'Integrations', href: '/dashboard/settings/integrations', icon: Link2, navId: 'nav_settings_integrations' },
  { label: 'Team', href: '/dashboard/settings/team', icon: UsersRound, navId: 'nav_settings_team' },
  { label: 'Billing', href: '/dashboard/directory-billing', icon: CreditCard, navId: 'nav_settings_billing' },
];

const listingItems: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard/listing', icon: LayoutDashboard, navId: 'nav_listing_dashboard' },
  { label: 'Pricing Guide', href: '/dashboard/listing/pricing-guide', icon: Sparkles, navId: 'nav_listing_pricing_guide' },
  { label: 'Booking System', href: '/dashboard/listing/booking-system', icon: Zap, navId: 'nav_listing_booking_system' },
  { label: 'Plans & billing', href: '/dashboard/directory-billing', icon: CreditCard, navId: 'nav_listing_directory_billing' },
  { label: 'Analytics', href: '/dashboard/listing/analytics', icon: BarChart3, navId: 'nav_listing_analytics' },
  { label: 'Reviews', href: '/dashboard/listing/reviews', icon: Star, navId: 'nav_listing_reviews' },
  { label: 'Verified & Sponsored', href: '/dashboard/listing/directory', icon: BadgeCheck, navId: 'nav_listing_directory' },
];

type FlyoutGroup = 'payments' | 'marketing' | 'settings' | 'listing' | null;

// Routes visible in the mobile slide-out menu. Anything not listed here
// is hidden when the menu is opened on phones / tablets (< lg breakpoint).
// Owners can still navigate to hidden pages directly via URL on desktop.
const MOBILE_ALLOWED_NAV_IDS = new Set<string>([
  // Main
  'nav_main_home',
  'nav_main_contacts',
  'nav_main_conversations',
  'nav_main_calendar',
  'nav_main_leads',
  'nav_main_help',
  // Listing — desktop-only subpages (pricing guide, booking system, reviews)
  // are intentionally NOT in this list so they're hidden on mobile/tablet.
  'nav_listing_dashboard',
  'nav_listing_analytics',
  'nav_listing_directory',
  'nav_listing_directory_billing',
  // Payments — all
  'nav_payments_new',
  'nav_offerings',
  'nav_payments_coupons',
  'nav_payments_proposals',
  'nav_proposals_hub',
  'nav_payments_installments',
  'nav_payments_subscriptions',
  'nav_transactions',
  'nav_settings_notifications',
  'nav_payments_settings',
  // Marketing — analytics only
  'nav_marketing_analytics',
  // Settings — "General" hidden on mobile (uses the desktop layout heavily)
  'nav_settings_branding',
  'nav_settings_team',
]);

export default function Sidebar({
  venue: _venue,
  role = 'owner',
  memberName,
  memberEmail: _memberEmail,
  collapsed = false,
  onToggleCollapsed,
  allowedNavIds = null,
  isLegacyPlan = false,
}: SidebarProps) {
  const isOwner = role === 'owner';
  const isAdmin = role === 'owner' || role === 'admin';
  const pathname = usePathname();
  /**
   * Plan-level access check. Returns true when the current plan grants this
   * nav id (or when there is no plan at all — legacy_full). Locked items
   * still render in the sidebar; this just controls whether the click
   * navigates or opens the upgrade modal.
   */
  const navOk = (navId: string) => allowedNavIds === null || allowedNavIds.includes(navId);
  const isOnListing = pathname.startsWith('/dashboard/listing');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [flyout, setFlyout] = useState<FlyoutGroup>(null);
  const [flyoutPos, setFlyoutPos] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const [convUnread, setConvUnread] = useState(0);
  const [updatesUnread, setUpdatesUnread] = useState(0);
  const [conciergeUnread, setConciergeUnread] = useState(0);
  const [paymentsActive, setPaymentsActive] = useState<boolean | null>(null); // null = loading
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);
  /** Locked-feature upgrade modal (opened when a locked menu item is clicked). */
  const [lockedItem, setLockedItem] = useState<NavItem | null>(null);

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

  const refreshConciergeUnread = useCallback(() => {
    void fetch('/api/conversations/venue-direct/unread-count')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { count?: number } | null) => {
        if (d && typeof d.count === 'number') setConciergeUnread(d.count);
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

  useEffect(() => {
    refreshConciergeUnread();
    const t = setInterval(refreshConciergeUnread, 45000);
    const onEvt = () => refreshConciergeUnread();
    window.addEventListener('storypay:concierge-unread', onEvt);
    return () => {
      clearInterval(t);
      window.removeEventListener('storypay:concierge-unread', onEvt);
    };
  }, [refreshConciergeUnread]);

  // Refresh whenever we land on a page that may have just consumed unread
  // venue_direct messages (the inline panel on /dashboard/contacts/[id] and
  // the dedicated /dashboard/concierge inbox both call mark-read on view).
  useEffect(() => {
    if (
      pathname.startsWith('/dashboard/concierge') ||
      pathname.startsWith('/dashboard/contacts/')
    ) {
      // Small delay so the read-write completes before we refetch the count.
      const t = setTimeout(refreshConciergeUnread, 1500);
      return () => clearTimeout(t);
    }
  }, [pathname, refreshConciergeUnread]);

  // Fetch payments active status once on mount (and after onboarding completes).
  const refreshPaymentsActive = useCallback(() => {
    fetch('/api/lunarpay/active', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null)
      .then((d: { active?: boolean } | null) => {
        setPaymentsActive(d?.active ?? false);
      })
      .catch(() => setPaymentsActive(false));
  }, []);

  useEffect(() => {
    refreshPaymentsActive();
  }, [refreshPaymentsActive]);

  // Listen for the global "open onboarding" event fired by the settings banner.
  useEffect(() => {
    const handler = () => setShowOnboardingModal(true);
    window.addEventListener('storypay:open-onboarding', handler);
    return () => window.removeEventListener('storypay:open-onboarding', handler);
  }, []);

  // Notifications lives under /dashboard/settings/* but belongs to the Payments
  // menu group. Treat its path as payments-active, not settings-active.
  const paymentSettingsPaths = [
    '/dashboard/settings/notifications',
  ];
  const isOnPaymentSettings = paymentSettingsPaths.some((p) => pathname.startsWith(p));
  // /dashboard/directory-billing is the SaaS plan & billing page. It also has a
  // legacy entry under "Venue listing" but its canonical home is Settings → Billing.
  const isOnSettingsBilling = pathname.startsWith('/dashboard/directory-billing');
  const isOnSettings =
    (pathname.startsWith('/dashboard/settings') && !isOnPaymentSettings) || isOnSettingsBilling;
  const isOnMarketing = pathname.startsWith('/dashboard/marketing');
  const isOnPayments = pathname.startsWith('/dashboard/payments')
    || pathname.startsWith('/dashboard/transactions')
    || pathname.startsWith('/dashboard/invoices')
    || pathname.startsWith('/dashboard/proposals')
    || isOnPaymentSettings;

  // For legacy plans, filter out the Billing item from Settings and Listing groups
  const visibleSettingsItems = isLegacyPlan
    ? settingsItems.filter(item => item.navId !== 'nav_settings_billing')
    : settingsItems;
  const visibleListingItems = isLegacyPlan
    ? listingItems.filter(item => item.navId !== 'nav_listing_directory_billing')
    : listingItems;

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

  // Role-based visibility (these items are completely hidden from members,
  // not just locked — different concern from plan gating).
  const settingsFiltered = visibleSettingsItems.filter((sub) => {
    if (!isOwner && sub.label === 'General') return false;
    if (!isOwner && sub.label === 'Team') return false;
    if (!isOwner && sub.label === 'Integrations') return false;
    return true;
  });

  // Plan gating no longer hides items — locked entries render greyed-out
  // with a lock icon and open the upgrade modal on click.
  const listingFiltered = visibleListingItems;
  const paymentsFiltered = paymentsItems;
  const marketingFiltered = marketingItems;

  // Mobile-only filtered copies (used when rendering the slide-out menu)
  const mobileListing   = listingFiltered.filter((s)   => MOBILE_ALLOWED_NAV_IDS.has(s.navId));
  const mobilePayments  = paymentsFiltered.filter((s)  => MOBILE_ALLOWED_NAV_IDS.has(s.navId));
  const mobileMarketing = marketingFiltered.filter((s) => MOBILE_ALLOWED_NAV_IDS.has(s.navId));
  const mobileSettings  = settingsFiltered.filter((s)  => MOBILE_ALLOWED_NAV_IDS.has(s.navId));

  /**
   * Renders a sub-menu item (Listing → Pricing Guide, Payments → Coupons,
   * etc) with a normal Link when accessible, or a greyed-out lock-styled
   * button when the plan does not include this nav id. Locked clicks open
   * the shared upgrade modal instead of navigating. Used by both the
   * expanded group lists and the collapsed-sidebar flyout panels.
   */
  function SubNavLink({
    sub,
    active,
    onClickAfter,
    flyoutVariant = false,
  }: {
    sub: NavItem;
    active: boolean;
    onClickAfter?: () => void;
    flyoutVariant?: boolean;
  }) {
    const SubIcon = sub.icon;
    const locked = !navOk(sub.navId);

    // Locked sub-items render with the SAME color as accessible ones —
    // only the trailing lock icon distinguishes them. Click is intercepted
    // by the modal handler instead of navigating.
    const cls = flyoutVariant
      ? `flex items-center gap-2 px-3 py-2 text-sm ${
          active && !locked
            ? 'font-semibold text-gray-900 bg-gray-50'
            : 'text-gray-600 hover:bg-gray-50'
        }`
      : subItem(active && !locked);

    if (locked) {
      return (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setLockedItem(sub);
            onClickAfter?.();
          }}
          title={`${sub.label} (locked — upgrade to access)`}
          aria-disabled
          className={`${cls} w-full text-left`}
          style={!flyoutVariant ? subItemStyle(false) : undefined}
        >
          <SubIcon size={14} />
          <span className="flex-1">{sub.label}</span>
          <Lock size={11} className="text-gray-400" />
        </button>
      );
    }

    return (
      <Link
        href={sub.href}
        className={cls}
        style={!flyoutVariant ? subItemStyle(active) : undefined}
        onClick={onClickAfter}
      >
        <SubIcon size={14} />
        <span>{sub.label}</span>
      </Link>
    );
  }

  const NavContent = ({ rail, onCloseMobile, isMobile = false }: { rail: boolean; onCloseMobile?: () => void; isMobile?: boolean }) => (
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
                alt="StoryVenue"
                width={40}
                height={40}
                className="object-contain opacity-90"
                priority
              />
            ) : (
              <Image
                src="/storyvenue-dark-logo.png"
                alt="StoryVenue"
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
          // Role-based filters still hide entries entirely — admin-only
          // pages are not "locked", they simply don't apply to members.
          if (!isAdmin && item.label === 'Reports') return false;
          if (!isAdmin && item.label === "What's New") return false;
          // On mobile, restrict to the curated phone-friendly route list.
          // "Ask AI" is a button, not a route, so always allowed.
          if (isMobile && item.label !== 'Ask AI' && !MOBILE_ALLOWED_NAV_IDS.has(item.navId)) return false;
          return true;
        }).map((item) => {
          const Icon = item.icon;
          const isAI = item.label === 'Ask AI' || item.label === 'Support';
          const isHelpCenter = item.label === 'Help Center';
          const isConversations = item.href === '/dashboard/conversations';
          const isUpdates = item.href === '/dashboard/updates';
          const isConcierge = item.href === '/dashboard/concierge';
          const showConvBadge = isConversations && convUnread > 0;
          const showUpdatesBadge = isUpdates && updatesUnread > 0;
          const showConciergeBadge = isConcierge && conciergeUnread > 0;
          const badgeCount = showConvBadge
            ? convUnread
            : showUpdatesBadge
              ? updatesUnread
              : showConciergeBadge
                ? conciergeUnread
                : 0;
          const showBadge = showConvBadge || showUpdatesBadge || showConciergeBadge;
          const locked = !navOk(item.navId);
          // Locked items can't be active; their grey style overrides the
          // selected highlight even on the route they "would" match.
          const active = !locked && isActive(item.href);
          return (
            <Link
              key={item.label}
              href={locked ? '#' : isAI ? '#' : isHelpCenter ? '/dashboard/help?reset=1' : item.href}
              onClick={
                locked
                  ? (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setLockedItem(item);
                    }
                  : isAI
                    ? (e) => {
                      e.preventDefault();
                      window.dispatchEvent(new Event('open-ask-ai'));
                      onCloseMobile?.();
                    }
                    : () => onCloseMobile?.()
              }
              title={
                locked
                  ? `${item.label} (locked — upgrade to access)`
                  : rail
                    ? showBadge
                      ? `${item.label} (${badgeCount} unread)`
                      : item.label
                    : undefined
              }
              aria-disabled={locked}
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
                  {locked ? (
                    <Lock size={12} className="ml-auto shrink-0 text-gray-400" />
                  ) : showBadge ? (
                    <span className="ml-auto shrink-0 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold leading-none text-white tabular-nums">
                      {badgeCount > 99 ? '99+' : badgeCount}
                    </span>
                  ) : null}
                </>
              )}
            </Link>
          );
        })}

        {(isMobile ? mobileListing : listingFiltered).length > 0 ? (
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
                  {(isMobile ? mobileListing : listingFiltered).map((sub) => (
                    <SubNavLink key={sub.label} sub={sub} active={listingSubActive(sub.href)} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        ) : null}

        {(isMobile ? mobilePayments : paymentsFiltered).length > 0 ? (
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
                  {/* Apply for StoryPay™ — first item, shown when not yet active */}
                  {paymentsActive === false && (
                    <button
                      type="button"
                      onClick={() => setShowOnboardingModal(true)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold text-indigo-700 hover:bg-indigo-50 transition-colors whitespace-nowrap"
                    >
                      <Zap size={13} className="shrink-0 text-indigo-500" />
                      <span className="truncate">Apply for StoryPay™</span>
                    </button>
                  )}
                  {(isMobile ? mobilePayments : paymentsFiltered).map((sub) => (
                    <SubNavLink key={sub.label} sub={sub} active={isSubActive(sub.href)} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        ) : null}

        {isAdmin && (isMobile ? mobileMarketing : marketingFiltered).length > 0 ? (
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
                    {(isMobile ? mobileMarketing : marketingFiltered).map((sub) => (
                      <SubNavLink key={sub.label} sub={sub} active={isSubActive(sub.href)} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        ) : null}

        {isAdmin && (isMobile ? mobileSettings : settingsFiltered).length > 0 ? (
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
                    {(isMobile ? mobileSettings : settingsFiltered).map((sub) => (
                      <SubNavLink key={sub.label} sub={sub} active={pathname === sub.href} />
                    ))}
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
          title="Contact support"
          onClick={() => window.dispatchEvent(new Event('open-support'))}
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
          const active =
            group === 'settings'
              ? pathname === sub.href
              : group === 'listing'
                ? listingSubActive(sub.href)
                : isSubActive(sub.href);
          return (
            <SubNavLink
              key={sub.label}
              sub={sub}
              active={active}
              flyoutVariant
              onClickAfter={() => {
                setFlyout(null);
                setFlyoutPos(null);
              }}
            />
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
          <Image src="/storyvenue-dark-logo.png" alt="StoryVenue" width={90} height={22} />
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
        <NavContent rail={false} onCloseMobile={() => setMobileOpen(false)} isMobile />
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
      {/* Payments flyout (collapsed sidebar) */}
      {(() => {
        if (!flyout || flyout !== 'payments' || !flyoutPos || !collapsed) return null;
        const node = (
          <div
            className="hidden lg:block fixed z-[100] w-56 rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
            style={{ top: flyoutPos.top, left: flyoutPos.left }}
            role="menu"
          >
            {/* Apply for StoryPay™ — shown only when not yet active */}
            {paymentsActive === false && (
              <button
                type="button"
                onClick={() => { setShowOnboardingModal(true); setFlyout(null); setFlyoutPos(null); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 border-b border-gray-100 whitespace-nowrap"
              >
                <Zap size={13} className="shrink-0 text-indigo-500" />
                <span className="truncate">Apply for StoryPay™</span>
              </button>
            )}
            {paymentsFiltered.map((sub) => (
              <SubNavLink
                key={sub.label}
                sub={sub}
                active={isSubActive(sub.href)}
                flyoutVariant
                onClickAfter={() => { setFlyout(null); setFlyoutPos(null); }}
              />
            ))}
          </div>
        );
        return mounted ? createPortal(node, document.body) : null;
      })()}
      {flyoutPanel(marketingFiltered, 'marketing')}
      {flyoutPanel(settingsFiltered, 'settings')}

      {/* Locked-feature upgrade modal — opens when a member clicks a
          greyed-out menu entry their plan does not include. */}
      <LockedFeatureModal
        open={lockedItem !== null}
        onClose={() => setLockedItem(null)}
        featureName={lockedItem?.label}
      />

      {/* StoryPay Onboarding Modal */}
      {showOnboardingModal && mounted && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4">
          <div
            className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl scrollbar-autohide"
            onScroll={(e) => {
              const el = e.currentTarget;
              el.classList.add('is-scrolling');
              clearTimeout((el as HTMLElement & { _scrollTimer?: ReturnType<typeof setTimeout> })._scrollTimer);
              (el as HTMLElement & { _scrollTimer?: ReturnType<typeof setTimeout> })._scrollTimer = setTimeout(() => {
                el.classList.remove('is-scrolling');
              }, 800);
            }}
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <div className="flex items-center gap-2.5">
                <Zap size={18} className="text-indigo-600" />
                <h2 className="font-semibold text-gray-900">Apply for StoryPay™</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowOnboardingModal(false)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="px-6 py-5">
              <LunarPayOnboarding
                onActivated={() => {
                  refreshPaymentsActive();
                  setShowOnboardingModal(false);
                }}
              />
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
