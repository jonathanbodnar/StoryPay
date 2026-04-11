import { redirect } from 'next/navigation';
import { getVenueFromSession } from '@/lib/session';
import Sidebar from '@/components/Sidebar';
import AnnouncementTicker from '@/components/AnnouncementTicker';
import AskAIWidget from '@/components/AskAIWidget';
import ContextualHelpBadge from '@/components/ContextualHelpBadge';

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

      <div className="lg:ml-[260px]">
        {/* Spacer for mobile fixed top bar */}
        <div className="h-14 lg:hidden" />
        <AnnouncementTicker />
        <main className="min-h-screen pt-6 lg:pt-[68px] px-6 sm:px-8 lg:px-10 pb-10 max-w-7xl mx-auto">
          {children}
        </main>
      </div>
      <AskAIWidget />
      <ContextualHelpBadge />
    </div>
  );
}
