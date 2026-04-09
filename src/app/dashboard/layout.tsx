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
    <div className="min-h-screen" style={{ backgroundColor: '#ffffff' }}>
      <Sidebar venue={{ id: venue.id, name: venue.name, ghl_location_id: venue.ghl_location_id }} />
      <div className="lg:ml-[220px]">
        <AnnouncementTicker />
        <main className="min-h-screen pt-14 lg:pt-0 p-6 sm:p-8 lg:p-10 max-w-7xl mx-auto">
          {children}
        </main>
      </div>
      <AskAIWidget />
    </div>
  );
}
