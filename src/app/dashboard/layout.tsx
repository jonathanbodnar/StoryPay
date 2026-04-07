import { redirect } from 'next/navigation';
import { getVenueFromSession } from '@/lib/session';
import Sidebar from '@/components/Sidebar';
import AnnouncementTicker from '@/components/AnnouncementTicker';
import AskAIWidget from '@/components/AskAIWidget';

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
    <div className="min-h-screen bg-white">
      <Sidebar venue={{ id: venue.id, name: venue.name, ghl_location_id: venue.ghl_location_id }} />
      <div className="lg:ml-[240px]">
        <AnnouncementTicker />
        {/* Desktop: offset by sidebar width. Mobile: add top padding for mobile header bar */}
        <main className="min-h-screen pt-14 lg:pt-0 p-4 sm:p-6 lg:p-10">
          <div className="p-1">
            {children}
          </div>
        </main>
      </div>
      <AskAIWidget />
    </div>
  );
}
