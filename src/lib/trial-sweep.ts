/**
 * Trial / billing sweep for the card-gated subscription model.
 *
 * IMPORTANT POLICY: we NEVER auto-downgrade a venue to Free. A card on file
 * means the venue is charged at trial end unless THEY explicitly chose to
 * downgrade. This sweep therefore does only two things:
 *
 *   1. Reminders — email/SMS a few days before the trial ends so the upcoming
 *      $97 charge is never a surprise (the chargeback shield). We skip venues
 *      that already chose to downgrade.
 *
 *   2. Honor explicit, user-chosen deferred downgrades — when an owner clicked
 *      "switch to Free", we cancel their sub but keep access until period end
 *      by stamping `directory_downgrade_at`. Once that moment passes, we apply
 *      the Free plan. This is the user's decision, executed on schedule — NOT
 *      an automatic downgrade.
 *
 * Trial end with a card on file and no chosen downgrade is handled by LunarPay
 * auto-charging the subscription; the webhook flips status to 'active'.
 */
import { supabaseAdmin } from '@/lib/supabase';
import { applyFreeDowngrade } from '@/lib/venue-billing';
import { resolveVenueProPlan } from '@/lib/trial-plans';
import { notifyVenueTrialEndingSoon } from '@/lib/saas-billing-notifications';
import { daysRemainingInTrial } from '@/lib/directory-trial';

/** Send the "trial ends soon" reminder when this many days (or fewer) remain. */
const REMIND_WITHIN_DAYS = 3;

export type TrialSweepResult = {
  remindersSent: number;
  downgradesApplied: number;
  errors: number;
};

export async function processTrialSweep(): Promise<TrialSweepResult> {
  const nowIso = new Date().toISOString();
  const result: TrialSweepResult = { remindersSent: 0, downgradesApplied: 0, errors: 0 };

  // The monthly charge to show in the reminder. Best-effort; reminder still
  // sends with $0 hidden if the plan can't be resolved.
  let amountCents = 0;
  try {
    const pro = await resolveVenueProPlan();
    amountCents = typeof pro?.price_monthly_cents === 'number' ? pro.price_monthly_cents : 0;
  } catch { /* non-fatal */ }

  // ── 1. Trial-ending reminders ────────────────────────────────────────────
  // Carded, actively-trialing venues whose trial ends soon, who haven't already
  // chosen to downgrade and haven't been reminded yet.
  try {
    const soonIso = new Date(Date.now() + REMIND_WITHIN_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data: dueReminders } = await supabaseAdmin
      .from('venues')
      .select('id, directory_trial_ends_at, directory_trial_is_forever, directory_downgrade_at, directory_trial_reminder_sent_at, directory_subscription_status')
      .eq('directory_subscription_status', 'trialing')
      .not('directory_trial_ends_at', 'is', null)
      .lte('directory_trial_ends_at', soonIso)
      .gt('directory_trial_ends_at', nowIso)
      .is('directory_trial_reminder_sent_at', null)
      .is('directory_downgrade_at', null)
      .limit(200);

    for (const row of (dueReminders ?? []) as Record<string, unknown>[]) {
      if (row.directory_trial_is_forever) continue;
      const venueId = String(row.id);
      const endsAt = (row.directory_trial_ends_at as string | null) ?? null;
      try {
        const daysLeft = Math.max(
          1,
          daysRemainingInTrial({
            directory_trial_started_at: null,
            directory_trial_ends_at: endsAt,
            directory_trial_is_forever: false,
            directory_trial_plan_id: null,
            directory_trial_consumed: true,
          }),
        );
        await notifyVenueTrialEndingSoon(venueId, { trialEndsAt: endsAt, amountCents, daysLeft });
        await supabaseAdmin
          .from('venues')
          .update({ directory_trial_reminder_sent_at: nowIso })
          .eq('id', venueId);
        result.remindersSent += 1;
      } catch (e) {
        console.error('[trial-sweep] reminder failed', venueId, e);
        result.errors += 1;
      }
    }
  } catch (e) {
    console.error('[trial-sweep] reminder query failed', e);
    result.errors += 1;
  }

  // ── 2. Honor explicit, user-chosen deferred downgrades ────────────────────
  try {
    const { data: dueDowngrades } = await supabaseAdmin
      .from('venues')
      .select('id, directory_downgrade_at')
      .not('directory_downgrade_at', 'is', null)
      .lte('directory_downgrade_at', nowIso)
      .limit(200);

    for (const row of (dueDowngrades ?? []) as Record<string, unknown>[]) {
      const venueId = String(row.id);
      try {
        await applyFreeDowngrade(venueId);
        result.downgradesApplied += 1;
      } catch (e) {
        console.error('[trial-sweep] downgrade failed', venueId, e);
        result.errors += 1;
      }
    }
  } catch (e) {
    console.error('[trial-sweep] downgrade query failed', e);
    result.errors += 1;
  }

  return result;
}
