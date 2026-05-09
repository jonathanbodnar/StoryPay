'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import AnnouncementTicker from '@/components/AnnouncementTicker';
// ImpersonationBanner rendered server-side in layout.tsx (black bar)
import { DirectoryRouteGuard } from '@/components/DirectoryRouteGuard';

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
  directoryBillingPending = false,
  emailVerificationPending = false,
  ownerEmail = '',
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
  /** Directory SaaS: priced plan assigned, payment still required. */
  directoryBillingPending?: boolean;
  /** True when the venue's email address has not yet been verified. */
  emailVerificationPending?: boolean;
  /** Owner email address (shown in the verification banner). */
  ownerEmail?: string;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [paymentsActive, setPaymentsActive] = useState<boolean | null>(null);
  const [verifyResent, setVerifyResent] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

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
    '/dashboard/media',
    '/dashboard/help',
    '/dashboard/payments',
    '/dashboard/settings/branding',
  ];
  const isFullWidth = pathname === '/dashboard' || fullWidthPaths.some((p) => pathname.startsWith(p));

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: '#ffffff', '--sidebar-w': rail ? '60px' : '216px' } as React.CSSProperties}
    >
      {/* ImpersonationBanner removed — rendered once in layout.tsx */}
      <Sidebar
        venue={venue}
        role={role}
        memberName={memberName}
        memberEmail={memberEmail}
        collapsed={rail}
        onToggleCollapsed={toggleCollapsed}
        allowedNavIds={allowedNavIds}
        isLegacyPlan={isLegacyPlan}
      />

      <div
        className={`transition-[margin] duration-200 ease-out ${
          rail ? 'lg:ml-[60px]' : 'lg:ml-[216px]'
        }`}
      >
        <div className="h-14 lg:hidden" />
        <AnnouncementTicker />
        <main className={`mx-auto flex min-h-screen w-full flex-col px-6 pb-10 pt-6 sm:px-8 lg:px-10 lg:pt-[68px] ${isFullWidth ? '' : 'max-w-[1024px]'}`}>
          {directoryBillingPending ? (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              <span className="font-semibold">Directory plan payment due.</span>{' '}
              <Link href="/dashboard/directory-billing" className="underline font-medium hover:text-amber-900">
                Add a card and start your subscription
              </Link>
              .
            </div>
          ) : null}

          {emailVerificationPending ? (
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

          {/* StoryPay not active banner — shown only on the main /dashboard/settings page */}
          {pathname === '/dashboard/settings' && paymentsActive === false ? (
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
                  Apply for StoryPay™
                </button>
                .
              </span>
            </div>
          ) : null}

          <DirectoryRouteGuard allowedNavIds={allowedNavIds}>{children}</DirectoryRouteGuard>
        </main>
      </div>
    </div>
  );
}
