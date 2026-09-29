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
    const due = await applyDueFreeDowngrades();
    result.downgradesApplied += due.applied;
    result.errors += due.errors;
  } catch (e) {
    console.error('[trial-sweep] downgrade query failed', e);
    result.errors += 1;
  }

  return result;
}

/** How long past a Stripe venue's end date to leave it to Stripe's own webhook. */
const STRIPE_WEBHOOK_GRACE_MS = 30 * 60 * 1000;

/**
 * Venues that cancelled keep their plan until `directory_downgrade_at` (the end
 * of the term they paid for, or their trial), then move to Free here. Stripe
 * ends its subscription at that moment and its webhook usually gets there
 * first; this covers everything else (LunarPay venues, trials with no card, a
 * missed webhook). Run by the in-app scheduler (lib/in-app-scheduler.ts).
 */
export async function applyDueFreeDowngrades(): Promise<{ applied: number; errors: number }> {
  const now = Date.now();
  const out = { applied: 0, errors: 0 };
  const { data, error } = await supabaseAdmin
    .from('venues')
    .select('id, directory_downgrade_at, stripe_subscription_id')
    .not('directory_downgrade_at', 'is', null)
    .lte('directory_downgrade_at', new Date(now).toISOString())
    .limit(200);
  if (error) throw new Error(error.message);

  for (const row of (data ?? []) as { id: string; directory_downgrade_at: string; stripe_subscription_id: string | null }[]) {
    if (row.stripe_subscription_id && new Date(row.directory_downgrade_at).getTime() > now - STRIPE_WEBHOOK_GRACE_MS) {
      continue;
    }
    // Claim the row so a second run can't apply (and email) it twice.
    const { data: claimed } = await supabaseAdmin
      .from('venues')
      .update({ directory_downgrade_at: null })
      .eq('id', row.id)
      .eq('directory_downgrade_at', row.directory_downgrade_at)
      .select('id');
    if (!claimed?.length) continue;
    try {
      await applyFreeDowngrade(row.id);
      out.applied += 1;
    } catch (e) {
      // Put the date back so the next run tries again.
      await supabaseAdmin.from('venues').update({ directory_downgrade_at: row.directory_downgrade_at }).eq('id', row.id);
      console.error('[free-downgrades] downgrade failed', row.id, e);
      out.errors += 1;
    }
  }
  return out;
}
