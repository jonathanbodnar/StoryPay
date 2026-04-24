'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import AnnouncementTicker from '@/components/AnnouncementTicker';
import ImpersonationBanner from '@/components/ImpersonationBanner';
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
  directoryBillingPending = false,
  children,
}: {
  venue: Venue;
  role: UserRole;
  memberName: string | null;
  memberEmail: string | null;
  /** null = full access (no directory plan). */
  allowedNavIds?: string[] | null;
  /** Directory SaaS: priced plan assigned, payment still required. */
  directoryBillingPending?: boolean;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage.getItem(STORAGE_KEY) === '1') {
        setCollapsed(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

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

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: '#ffffff', '--sidebar-w': rail ? '60px' : '216px' } as React.CSSProperties}
    >
      <ImpersonationBanner />
      <Sidebar
        venue={venue}
        role={role}
        memberName={memberName}
        memberEmail={memberEmail}
        collapsed={rail}
        onToggleCollapsed={toggleCollapsed}
        allowedNavIds={allowedNavIds}
      />

      <div
        className={`transition-[margin] duration-200 ease-out ${
          rail ? 'lg:ml-[60px]' : 'lg:ml-[216px]'
        }`}
      >
        <div className="h-14 lg:hidden" />
        <AnnouncementTicker />
        <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 pb-10 pt-6 sm:px-8 lg:px-10 lg:pt-[68px]">
          {directoryBillingPending ? (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              <span className="font-semibold">Directory plan payment due.</span>{' '}
              <Link href="/dashboard/directory-billing" className="underline font-medium hover:text-amber-900">
                Add a card and start your subscription
              </Link>
              .
            </div>
          ) : null}
          <DirectoryRouteGuard allowedNavIds={allowedNavIds}>{children}</DirectoryRouteGuard>
        </main>
      </div>
    </div>
  );
}
