import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { loadDirectoryNavAccess } from '@/lib/directory-plans-venue';
import { supabaseAdmin } from '@/lib/supabase';
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

 const navAccess = await loadDirectoryNavAccess(user.venueId);

 const { data: billingRow } = await supabaseAdmin
   .from('venues')
   .select('directory_subscription_status')
   .eq('id', user.venueId)
   .maybeSingle();
 const directoryBillingPending =
   user.isAdmin && billingRow?.directory_subscription_status === 'pending_payment';

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
 allowedNavIds={navAccess.allowedNavIds}
 directoryBillingPending={directoryBillingPending}
 >
 {children}
 </DashboardShell>
 <AskAIWidget />
 </div>
 );
}
