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
 const inTrial = subStatus === 'trialing' && !trialState.directory_trial_is_forever;
 // A venue that downgraded to Free *during* its 14-day trial window keeps an
 // informational countdown until the original trial-end date passes, then it
 // disappears. They have no subscription on file so they won't be charged — the
 // ribbon is an upgrade nudge, not a billing notice.
 const onFreeDuringTrialWindow =
   subStatus === 'none' &&
   !hasExternalSub &&
   !navAccess.isLegacyPlan &&
   !trialState.directory_trial_is_forever &&
   Boolean(trialState.directory_trial_ends_at) &&
   trialStatus === 'active';
 // The countdown ribbon shows during an active trial whether or not a card is
 // on file. Card-on-file venues still need to see when they'll be charged (and
 // how to switch to Free before then); pre-card venues see the "add a card"
 // prompt; downgraded-to-Free venues see an upgrade nudge. Only the hard wall
 // stays gated to the no-card trialing path — a card-on-file venue auto-charges
 // at trial end rather than getting locked out.
 const showTrialCountdown = (inTrial && trialStatus === 'active') || onFreeDuringTrialWindow;
 const trialExpiredWall = inTrial && !hasExternalSub && trialStatus === 'expired';
 const trialDaysRemaining = showTrialCountdown ? daysRemainingInTrial(trialState) : 0;
 const trialEndsAt = (vr.directory_trial_ends_at as string | null) ?? null;

 // Venues can access the dashboard (directory listing, leads, etc.) without
 // having finished LunarPay payment onboarding. If they want to take payments
 // they can opt into /setup from the dashboard itself.

 // A super admin "viewing as venue" must never be trapped behind a full-screen
 // gate — they need the dashboard + the exit ribbon. Show the wall only to the
 // actual venue.
 if (trialExpiredWall && !isImpersonating) {
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
 trialHasCard={hasExternalSub}
 trialFreePlan={onFreeDuringTrialWindow}
 >
 {children}
 </DashboardShell>
 <AskAIWidget />
 {/* Suppress the blocking go-live/card modal while a super admin is viewing as
     this venue — otherwise it covers the exit ribbon and they can't get back. */}
 {user.isAdmin && !isImpersonating && <OnboardingWizard />}
 </div>
 );
}
