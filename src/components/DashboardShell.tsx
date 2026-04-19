'use client';

import { useCallback, useEffect, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import AnnouncementTicker from '@/components/AnnouncementTicker';

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
  children,
}: {
  venue: Venue;
  role: UserRole;
  memberName: string | null;
  memberEmail: string | null;
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
    <div className="min-h-screen" style={{ backgroundColor: '#ffffff' }}>
      <Sidebar
        venue={venue}
        role={role}
        memberName={memberName}
        memberEmail={memberEmail}
        collapsed={rail}
        onToggleCollapsed={toggleCollapsed}
      />

      <div
        className={`transition-[margin] duration-200 ease-out ${
          rail ? 'lg:ml-[72px]' : 'lg:ml-[260px]'
        }`}
      >
        <div className="h-14 lg:hidden" />
        <AnnouncementTicker />
        <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 pb-10 pt-6 sm:px-8 lg:px-10 lg:pt-[68px]">
          {children}
        </main>
      </div>
    </div>
  );
}
