import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getSessionUser } from '@/lib/session';
import { loadDirectoryNavAccess } from '@/lib/directory-plans-venue';
import { supabaseAdmin } from '@/lib/supabase';
import DashboardShell from '@/components/DashboardShell';
import AskAIWidget from '@/components/AskAIWidget';
import ImpersonationBanner from '@/components/admin/ImpersonationBanner';

export default async function DashboardLayout({
 children,
}: {
 children: React.ReactNode;
}) {
 const user = await getSessionUser();

 if (!user) {
 redirect('/');
 }

 const cookieStore = await cookies();
 const isImpersonating = cookieStore.get('admin_impersonating')?.value === '1';

 const navAccess = await loadDirectoryNavAccess(user.venueId);

 const { data: billingRow } = await supabaseAdmin
   .from('venues')
   .select('directory_subscription_status, email_verified_at, email')
   .eq('id', user.venueId)
   .maybeSingle();
 const directoryBillingPending =
   user.isAdmin && billingRow?.directory_subscription_status === 'pending_payment';

 // Email verification banner: only relevant for the venue owner (team
 // members didn't go through signup). The column is added by migration
 // 123; existing venues are grandfathered as already verified.
 const emailVerifiedAt = (billingRow as { email_verified_at?: string | null } | null)?.email_verified_at;
 const showVerifyBanner =
   user.isAdmin && emailVerifiedAt !== undefined && !emailVerifiedAt;
 const ownerEmail = (billingRow as { email?: string | null } | null)?.email ?? '';

 // Venues can access the dashboard (directory listing, leads, etc.) without
 // having finished LunarPay payment onboarding. If they want to take payments
 // they can opt into /setup from the dashboard itself.

 return (
 <div className={`min-h-screen${isImpersonating ? ' pt-10' : ''}`} style={{ backgroundColor: '#ffffff' }}>
 {isImpersonating && <ImpersonationBanner venueName={user.venueName} />}
 <DashboardShell
 venue={{ id: user.venueId, name: user.venueName, ghl_location_id: '' }}
 role={user.role}
 memberName={user.memberName}
 memberEmail={user.memberEmail}
 allowedNavIds={navAccess.allowedNavIds}
 isLegacyPlan={navAccess.isLegacyPlan}
 directoryBillingPending={directoryBillingPending}
 emailVerificationPending={showVerifyBanner}
 ownerEmail={ownerEmail}
 >
 {children}
 </DashboardShell>
 <AskAIWidget />
 </div>
 );
}
