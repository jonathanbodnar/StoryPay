'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import AnnouncementTicker from '@/components/AnnouncementTicker';
import MobileTabBar from '@/components/MobileTabBar';
import MobileDashboardRedirect from '@/components/MobileDashboardRedirect';
import NativePushRegistrar from '@/components/NativePushRegistrar';
// ImpersonationBanner rendered server-side in layout.tsx (black bar)
import { DirectoryRouteGuard } from '@/components/DirectoryRouteGuard';
import UsageTracker from '@/components/analytics/UsageTracker';
import OnboardingLauncher from '@/components/onboarding/OnboardingLauncher';
import { trackClient } from '@/lib/analytics-client';
import { isNativeApp, openExternalBrowser } from '@/lib/platform';

const STORAGE_KEY = 'storypay.dashboard.sidebarCollapsed';

interface Venue {
  id: string;
  name: string;
  ghl_location_id: string;
}

type UserRole = 'owner' | 'admin' | 'member';

export default function DashboardShell({
  venue,
  role,
  memberName,
  memberEmail,
  allowedNavIds = null,
  isLegacyPlan = false,
  isFreePlan = false,
  directoryBillingPending = false,
  emailVerificationPending = false,
  ownerEmail = '',
  trialCountdown = false,
  trialDaysRemaining = 0,
  trialEndsAt = null,
  trialHasCard = false,
  trialFreePlan = false,
  children,
}: {
  venue: Venue;
  role: UserRole;
  memberName: string | null;
  memberEmail: string | null;
  /** null = full access (no directory plan). */
  allowedNavIds?: string[] | null;
  /** True when the venue is on a legacy/manually-billed plan. */
  isLegacyPlan?: boolean;
  /** True when the venue is on the free plan (price = $0). */
  isFreePlan?: boolean;
  /** Directory SaaS: priced plan assigned, payment still required. */
  directoryBillingPending?: boolean;
  /** True when the venue's email address has not yet been verified. */
  emailVerificationPending?: boolean;
  /** Owner email address (shown in the verification banner). */
  ownerEmail?: string;
  /** True when the venue is on an active (not-yet-expired) Venue Pro trial. */
  trialCountdown?: boolean;
  /** Whole days left in the active trial. */
  trialDaysRemaining?: number;
  /** ISO trial end date (for the countdown banner copy). */
  trialEndsAt?: string | null;
  /** True when a card is already on file — the trial will auto-charge at the end. */
  trialHasCard?: boolean;
  /** True when the venue downgraded to Free but is still inside the trial window. */
  trialFreePlan?: boolean;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [paymentsActive, setPaymentsActive] = useState<boolean | null>(null);
  const [verifyResent, setVerifyResent] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [startEarlyBusy, setStartEarlyBusy] = useState(false);
  const [startEarlyError, setStartEarlyError] = useState('');

  const startTrialEarly = useCallback(async () => {
    setStartEarlyBusy(true);
    setStartEarlyError('');
    trackClient('upgrade_started', { label: 'Start Venue Pro early' });
    try {
      const res = await fetch('/api/venue-billing/start-paid', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        throw new Error(data.error || 'Could not start checkout.');
      }
      // On native, open the checkout in the external system browser so the
      // purchase flow never happens inside the app webview (Apple/Play rules).
      if (isNativeApp()) {
        await openExternalBrowser(data.url as string);
        setStartEarlyBusy(false);
        return;
      }
      window.location.href = data.url as string;
    } catch (e) {
      setStartEarlyError(e instanceof Error ? e.message : 'Something went wrong.');
      setStartEarlyBusy(false);
    }
  }, []);

  // Route billing-page links out to the external browser on native so the
  // in-app webview never renders an Apple-risk upgrade/checkout flow. On the
  // web this is a no-op and the <Link> navigates normally.
  const routeBillingOut = useCallback((e: React.MouseEvent, path: string) => {
    if (!isNativeApp()) return;
    e.preventDefault();
    void openExternalBrowser(path);
  }, []);

  const resendVerification = useCallback(async () => {
    setVerifyResent('sending');
    try {
      const res = await fetch('/api/auth/resend-verification', { method: 'POST' });
      setVerifyResent(res.ok ? 'sent' : 'error');
    } catch {
      setVerifyResent('error');
    }
  }, []);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const isOnSettings = pathname.startsWith('/dashboard/settings');

  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage.getItem(STORAGE_KEY) === '1') {
        setCollapsed(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetch('/api/lunarpay/active', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null)
      .then((d: { active?: boolean } | null) => setPaymentsActive(d?.active ?? false))
      .catch(() => setPaymentsActive(false));
  }, []);

  // On first login (?welcome=1) open the "Get Started" onboarding checklist,
  // then strip the query param so it doesn't persist.
  useEffect(() => {
    if (searchParams.get('welcome') === '1') {
      window.dispatchEvent(new CustomEvent('onboarding:open'));
      router.replace('/dashboard');
    }
  }, [searchParams, router]);

  // Analytics: the trial countdown banner is an upgrade prompt — record a view
  // so we can measure prompt → upgrade_started → upgrade conversion.
  useEffect(() => {
    if (trialCountdown) trackClient('upgrade_prompt_viewed', { label: 'Trial countdown banner' });
  }, [trialCountdown]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const rail = collapsed;

  // Pages that need full-width content (no max-w constraint)
  const fullWidthPaths = [
    '/dashboard/contacts',
    '/dashboard/conversations',
    '/dashboard/calendar',
    '/dashboard/leads',
    '/dashboard/listing',
    '/dashboard/media',
    '/dashboard/help',
    '/dashboard/payments',
    '/dashboard/settings/branding',
  ];
  const isFullWidth = pathname === '/dashboard' || fullWidthPaths.some((p) => pathname.startsWith(p));

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: '#ffffff', '--sidebar-w': rail ? '60px' : '260px' } as React.CSSProperties}
    >
      {/* ImpersonationBanner removed — rendered once in layout.tsx */}
      <UsageTracker />
      {/* Native-shell push registration (no-op on the web). */}
      <NativePushRegistrar />
      <Sidebar
        venue={venue}
        role={role}
        memberName={memberName}
        memberEmail={memberEmail}
        collapsed={rail}
        onToggleCollapsed={toggleCollapsed}
        allowedNavIds={allowedNavIds}
        isLegacyPlan={isLegacyPlan}
        isFreePlan={isFreePlan}
      />

      <div
        className={`flex min-h-screen flex-col transition-[margin] duration-200 ease-out ${
          rail ? 'lg:ml-[60px]' : 'lg:ml-[260px]'
        }`}
      >
        {/* Spacer matching the fixed mobile top bar (3.5rem + status-bar inset). */}
        <div
          className="shrink-0 lg:hidden"
          style={{ height: 'calc(3.5rem + env(safe-area-inset-top, 0px))' }}
        />
        <AnnouncementTicker />
        <MobileDashboardRedirect />
        <main className={`mx-auto flex w-full flex-1 flex-col px-6 pb-28 pt-6 sm:px-8 lg:px-10 lg:pt-[68px] lg:pb-10 ${isFullWidth ? '' : 'max-w-[1024px]'}`}>
          {role !== 'member' && <OnboardingLauncher />}
          {trialCountdown ? (
            trialFreePlan ? (
              <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-800 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex-1">
                  <span className="font-semibold">
                    Bride Booking System™ trial · {trialDaysRemaining} day{trialDaysRemaining === 1 ? '' : 's'} left
                  </span>
                  {' '}
                  <span className="text-gray-500">
                    You&apos;re on the Free plan — you won&apos;t be charged. Upgrade anytime to keep your full Bride Booking System™.
                  </span>
                </div>
                <Link
                  href="/dashboard/directory-billing"
                  onClick={(e) => routeBillingOut(e, '/dashboard/directory-billing')}
                  className="self-start sm:self-auto whitespace-nowrap rounded-lg bg-[#1b1b1b] px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-black"
                >
                  Upgrade
                </Link>
              </div>
            ) : trialHasCard ? (
              <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-800 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex-1">
                  <span className="font-semibold">
                    Bride Booking System™ trial · {trialDaysRemaining} day{trialDaysRemaining === 1 ? '' : 's'} left
                  </span>
                  {' '}
                  <span className="text-gray-500">
                    {trialEndsAt
                      ? `Your card will be charged $97/mo on ${new Date(trialEndsAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}. Switch to Free anytime before then.`
                      : 'Your card will be charged $97/mo when your trial ends. Switch to Free anytime before then.'}
                  </span>
                </div>
                <Link
                  href="/dashboard/directory-billing"
                  onClick={(e) => routeBillingOut(e, '/dashboard/directory-billing')}
                  className="self-start sm:self-auto whitespace-nowrap rounded-lg bg-[#1b1b1b] px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-black"
                >
                  Manage subscription
                </Link>
              </div>
            ) : (
              <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-800 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex-1">
                  <span className="font-semibold">
                    Venue Pro trial · {trialDaysRemaining} day{trialDaysRemaining === 1 ? '' : 's'} left
                  </span>
                  {' '}
                  <span className="text-gray-500">
                    {startEarlyError
                      ? startEarlyError
                      : trialEndsAt
                        ? `Add a card to keep full access — you won't be charged until ${new Date(trialEndsAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.`
                        : "Add a card to keep full access when your trial ends."}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={startTrialEarly}
                  disabled={startEarlyBusy}
                  className="self-start sm:self-auto whitespace-nowrap rounded-lg bg-[#1b1b1b] px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-black disabled:opacity-60"
                >
                  {startEarlyBusy ? 'Starting…' : 'Start Venue Pro early'}
                </button>
              </div>
            )
          ) : null}

          {directoryBillingPending ? (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              <span className="font-semibold">Directory plan payment due.</span>{' '}
              <Link
                href="/dashboard/directory-billing"
                onClick={(e) => routeBillingOut(e, '/dashboard/directory-billing')}
                className="underline font-medium hover:text-amber-900"
              >
                Add a card and start your subscription
              </Link>
              .
            </div>
          ) : null}

          {emailVerificationPending && pathname === '/dashboard' ? (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
              <div className="flex-1">
                <span className="font-semibold">Verify your email address to activate payment processing.</span>{' '}
                We sent a verification link to{' '}
                <span className="font-medium">{ownerEmail || 'your email'}</span>.
                Until then, you can&apos;t send proposals or take payments.
              </div>
              <button
                type="button"
                onClick={resendVerification}
                disabled={verifyResent === 'sending' || verifyResent === 'sent'}
                className="self-start sm:self-auto whitespace-nowrap rounded-lg border border-amber-700 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 transition disabled:opacity-60"
              >
                {verifyResent === 'sent'
                  ? 'Email sent'
                  : verifyResent === 'sending'
                    ? 'Sending…'
                    : verifyResent === 'error'
                      ? 'Try again'
                      : 'Resend email'}
              </button>
            </div>
          ) : null}

          {/* StoryPay not active banner — shown only on the main /dashboard/settings page.
              Hidden in the native shell (Apple-risk financial onboarding CTA). */}
          {!isNativeApp() && pathname === '/dashboard/settings' && paymentsActive === false ? (
            <div className="mb-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3.5 text-sm text-red-900">
              <span className="mt-0.5 shrink-0 text-red-500">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
              </span>
              <span>
                <span className="font-semibold">Payment processing is not active.</span>{' '}
                You cannot send proposals or process payments until your StoryPay™ merchant account is approved.{' '}
                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new CustomEvent('storypay:open-onboarding'))}
                  className="underline font-semibold hover:text-red-700"
                >
                  Signup for StoryPay™
                </button>
                .
              </span>
            </div>
          ) : null}

          <DirectoryRouteGuard allowedNavIds={allowedNavIds}>{children}</DirectoryRouteGuard>
        </main>
      </div>

      {/* Mobile-only chrome (hidden ≥ lg) */}
      <MobileTabBar venueId={venue.id} />
    </div>
  );
}
