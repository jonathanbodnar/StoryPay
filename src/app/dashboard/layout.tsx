import { redirect } from 'next/navigation';
import { getVenueFromSession } from '@/lib/session';
import Sidebar from '@/components/Sidebar';
import AnnouncementTicker from '@/components/AnnouncementTicker';
import AskAIWidget from '@/components/AskAIWidget';
import { LogOut } from 'lucide-react';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const venue = await getVenueFromSession();

  if (!venue) {
    redirect('/');
  }

  if (!venue.setup_completed) {
    redirect('/setup');
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#ffffff' }}>
      <Sidebar venue={{ id: venue.id, name: venue.name, ghl_location_id: venue.ghl_location_id }} />

      {/* Desktop / tablet top-right logout */}
      <div className="hidden sm:flex fixed top-3 right-4 z-30 items-center gap-2">
        <a
          href="/api/auth/logout"
          className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white/90 backdrop-blur px-3.5 py-2 text-sm font-medium text-gray-500 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-all shadow-sm"
          title="Logout"
        >
          <LogOut size={15} />
          <span className="hidden md:inline">Logout</span>
        </a>
      </div>

      <div className="lg:ml-[260px]">
        {/* Spacer for mobile fixed top bar */}
        <div className="h-14 lg:hidden" />
        <AnnouncementTicker />
        <main className="min-h-screen pt-6 lg:pt-[68px] px-6 sm:px-8 lg:px-10 pb-10 max-w-7xl mx-auto">
          {children}
        </main>
      </div>
      <AskAIWidget />
    </div>
  );
}
