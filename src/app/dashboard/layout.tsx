import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import Sidebar from '@/components/Sidebar';
import AnnouncementTicker from '@/components/AnnouncementTicker';
import AskAIWidget from '@/components/AskAIWidget';

export default async function DashboardLayout({
 children,
}: {
 children: React.ReactNode;
}) {
 const user = await getSessionUser();

 if (!user) {
 redirect('/');
 }

 // Venues can access the dashboard (directory listing, leads, etc.) without
 // having finished LunarPay payment onboarding. If they want to take payments
 // they can opt into /setup from the dashboard itself.

 return (
 <div className="min-h-screen"style={{ backgroundColor: '#ffffff' }}>
 <Sidebar
 venue={{ id: user.venueId, name: user.venueName, ghl_location_id: '' }}
 role={user.role}
 memberName={user.memberName}
 memberEmail={user.memberEmail}
 />

 <div className="lg:ml-[260px]">
 <div className="h-14 lg:hidden"/>
 <AnnouncementTicker />
 <main className="min-h-screen pt-6 lg:pt-[68px] px-6 sm:px-8 lg:px-10 pb-10 max-w-7xl mx-auto">
 {children}
 </main>
 </div>
 <AskAIWidget />
 </div>
 );
}
