import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import DashboardShell from '@/components/DashboardShell';
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
 <div className="min-h-screen" style={{ backgroundColor: '#ffffff' }}>
 <DashboardShell
 venue={{ id: user.venueId, name: user.venueName, ghl_location_id: '' }}
 role={user.role}
 memberName={user.memberName}
 memberEmail={user.memberEmail}
 >
 {children}
 </DashboardShell>
 <AskAIWidget />
 </div>
 );
}
