import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getSessionUser } from '@/lib/session';
import { loadDirectoryNavAccess } from '@/lib/directory-plans-venue';
import { supabaseAdmin } from '@/lib/supabase';
import { deriveTrialStatus, daysRemainingInTrial, type VenueTrialState } from '@/lib/directory-trial';
import DashboardShell from '@/components/DashboardShell';
import AskAIWidget from '@/components/AskAIWidget';
import ImpersonationBanner from '@/components/admin/ImpersonationBanner';
import TrialExpiredWall from '@/components/TrialExpiredWall';
import OnboardingWizard from '@/components/onboarding/OnboardingWizard';

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
   .select('directory_plan_id, directory_subscription_status, email_verified_at, email, directory_subscription_external_id, directory_trial_started_at, directory_trial_ends_at, directory_trial_is_forever, directory_trial_consumed')
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

 // ── Trial state ───────────────────────────────────────────────────────────
 // We compute trial status from directory_trial_ends_at at request time (there
 // is no cron flipping expired trials). The wall and countdown are gated VERY
 // conservatively so they can only affect the self-serve trial path:
 //   • subscription_status must be exactly 'trialing'
 //   • the venue must NOT have a LunarPay subscription on file
 //   • forever-trials are never gated
 // Paying venues ('active'), legacy/no-plan venues, and downgraded-to-free
 // venues ('none') are therefore never affected.
 const vr = (venueRow ?? {}) as Record<string, unknown>;
 const subStatus = String(vr.directory_subscription_status ?? 'none');
 const hasExternalSub = Boolean(vr.directory_subscription_external_id);
 const trialState: VenueTrialState = {
   directory_trial_started_at: (vr.directory_trial_started_at as string | null) ?? null,
   directory_trial_ends_at: (vr.directory_trial_ends_at as string | null) ?? null,
   directory_trial_is_forever: Boolean(vr.directory_trial_is_forever),
   directory_trial_plan_id: null,
   directory_trial_consumed: Boolean(vr.directory_trial_consumed),
 };
 const trialStatus = deriveTrialStatus(trialState);
 const onSelfServeTrial =
   subStatus === 'trialing' && !hasExternalSub && !trialState.directory_trial_is_forever;
 const trialExpiredWall = onSelfServeTrial && trialStatus === 'expired';
 const showTrialCountdown = onSelfServeTrial && trialStatus === 'active';
 const trialDaysRemaining = showTrialCountdown ? daysRemainingInTrial(trialState) : 0;
 const trialEndsAt = (vr.directory_trial_ends_at as string | null) ?? null;

 // Venues can access the dashboard (directory listing, leads, etc.) without
 // having finished LunarPay payment onboarding. If they want to take payments
 // they can opt into /setup from the dashboard itself.

 if (trialExpiredWall) {
   return <TrialExpiredWall venueName={user.venueName} />;
 }

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
 trialCountdown={showTrialCountdown}
 trialDaysRemaining={trialDaysRemaining}
 trialEndsAt={trialEndsAt}
 >
 {children}
 </DashboardShell>
 <AskAIWidget />
 {user.isAdmin && <OnboardingWizard />}
 </div>
 );
}
