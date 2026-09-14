'use client';

import { type ReactNode, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { CoupleLogo } from './CoupleLogo';
import { CoupleNav } from './CoupleNav';
import CoupleMobileTabBar from './CoupleMobileTabBar';
import CoupleMoreSheet from './CoupleMoreSheet';
import { coupleAuthedFetch, getCoupleSupabase } from '@/lib/couple-browser';
import { isNativeApp, topBarSafeAreaPadding } from '@/lib/platform';

/**
 * App shell for the couple ("bride") area. Mirrors the venue DashboardShell so
 * the bride experience feels like the same native app:
 *   - Desktop (lg+): the existing in-flow header + CoupleNav (web unchanged).
 *   - Mobile/tablet (below lg): a fixed, status-bar-safe top bar, a matching
 *     spacer, full-height content with bottom-tab clearance, and a fixed bottom
 *     tab bar (Home / Guests / Messages / Checklist / More).
 *
 * Auth + utility routes (login, signup, password reset, invite/claim/save)
 * render bare — they own their centered card layouts and must not inherit the
 * couple chrome (avoids the double-header on password reset).
 */
const BARE_ROUTES = [
  '/couple/login',
  '/couple/signup',
  '/couple/reset-password',
  '/couple/accept-invite',
  '/couple/claim',
  '/couple/save',
];

function isBareRoute(pathname: string): boolean {
  return BARE_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

export default function CoupleShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [session, setSession] = useState<boolean | null>(null);
  const [isCollaborator, setIsCollaborator] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    const supabase = getCoupleSupabase();
    void supabase.auth.getSession().then(({ data }) => setSession(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(!!s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Collaborator vs owning couple — drives owner-only tool visibility in More.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!session) {
        if (!cancelled) setIsCollaborator(false);
        return;
      }
      try {
        const res = await coupleAuthedFetch('/api/couple/wedding');
        const data = await res.json().catch(() => ({}));
        if (!cancelled) setIsCollaborator(data.access === 'edit' || data.access === 'view');
      } catch {
        if (!cancelled) setIsCollaborator(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  // The More sheet closes via its own link/backdrop handlers (onClose), so no
  // route-change effect is needed to dismiss it.

  if (isBareRoute(pathname)) {
    return <div className="min-h-screen bg-[#fafaf9]">{children}</div>;
  }

  const showTabs = session === true;

  return (
    <div className="min-h-screen bg-[#fafaf9]">
      {/* Desktop header (unchanged web experience) */}
      <header className="hidden border-b border-gray-200 bg-white lg:block">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <CoupleLogo />
          <CoupleNav />
        </div>
      </header>

      {/* Mobile fixed top bar. padding-top absorbs the iOS status-bar safe area
          (contentInset "never" in the native shell) and is floored at 44px on
          native so a not-yet-rebuilt binary (env()=0) still clears the status
          bar. env() is 0 in mobile browsers, so the web is unchanged. */}
      <div
        className="fixed left-0 right-0 top-0 z-40 border-b border-gray-200 bg-white lg:hidden"
        style={{ paddingTop: topBarSafeAreaPadding() }}
      >
        <div className="flex h-14 items-center justify-between px-4">
          <CoupleLogo />
        </div>
      </div>
      {/* Spacer matching the fixed mobile top bar (3.5rem + status-bar inset). */}
      <div
        className="lg:hidden"
        style={{
          height: isNativeApp()
            ? 'calc(3.5rem + max(env(safe-area-inset-top, 0px), 44px))'
            : 'calc(3.5rem + env(safe-area-inset-top, 0px))',
        }}
      />

      <main className={`mx-auto max-w-4xl px-4 pt-6 lg:py-8 ${showTabs ? 'pb-28' : 'pb-10'}`}>
        {children}
      </main>

      {showTabs && (
        <>
          <CoupleMobileTabBar moreOpen={moreOpen} onMore={() => setMoreOpen(true)} />
          {moreOpen && (
            <CoupleMoreSheet isCollaborator={isCollaborator} onClose={() => setMoreOpen(false)} />
          )}
        </>
      )}
    </div>
  );
}
