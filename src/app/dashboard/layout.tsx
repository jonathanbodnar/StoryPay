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

 // Single venues query covering all fields needed by the layout so we
 // don't hit the venues table 3 times per page render.
 const { data: venueRow } = await supabaseAdmin
   .from('venues')
   .select('directory_plan_id, directory_subscription_status, email_verified_at, email')
   .eq('id', user.venueId)
   .maybeSingle();

 // Pass pre-fetched plan ID so loadDirectoryNavAccess skips its own venues query.
 const navAccess = await loadDirectoryNavAccess(
   user.venueId,
   (venueRow as { directory_plan_id?: string | null } | null)?.directory_plan_id ?? null,
 );

 const billingRow = venueRow;
 const directoryBillingPending =
   user.isAdmin && billingRow?.directory_subscription_status === 'pending_payment';

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
