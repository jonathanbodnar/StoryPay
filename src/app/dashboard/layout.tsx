import { redirect } from 'next/navigation';
import { getVenueFromSession } from '@/lib/session';
import Sidebar from '@/components/Sidebar';

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
      {/* Desktop: offset by sidebar width. Mobile: add top padding for mobile header bar */}
      <main className="lg:ml-[240px] min-h-screen pt-14 lg:pt-0 p-4 sm:p-6 lg:p-8">
        <div className="bg-white rounded-xl border border-gray-100 p-4 sm:p-5 lg:p-6 min-h-[calc(100vh-4rem)]">
          {children}
        </div>
      </main>
    </div>
  );
}
