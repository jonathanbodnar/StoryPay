/**
 * Trial / billing sweep for the card-gated subscription model.
 *
 * IMPORTANT POLICY: we NEVER auto-downgrade a venue to Free. A card on file
 * means the venue is charged at trial end unless THEY explicitly chose to
 * downgrade. This sweep therefore does only two things:
 *
 *   1. Reminders — an email (never a text) a few days before the trial ends so the upcoming
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

const DAY_MS = 24 * 60 * 60 * 1000;
/** Days after a card-less trial ends before the venue moves to Free (owner's call, Sep 30). */
const NO_CARD_GRACE_DAYS = 7;

/**
 * Trials that ended (or are ending) without a card. Before, they sat behind the
 * "trial is over" wall forever with their automations off and no email. Now:
 *   • 3 days before the end: a heads-up (add a card, or you'll be on Free).
 *   • on the end date: one "your trial ended" notice with the Free date.
 *   • 7 days after: move to Free (applyFreeDowngrade sends "You're on the Free
 *     plan"). The listing stays published; nothing here touches is_published.
 * Skips demo, suspended, forever-trial and legacy-plan venues, and any venue
 * with a subscription or a scheduled downgrade.
 */
export async function processNoCardTrials(opts: { dryRun?: boolean } = {}): Promise<{ reminded: number; endedNotices: number; movedToFree: number; errors: number; venueIds: { reminded: string[]; endedNotices: string[]; movedToFree: string[] } }> {
  const dry = opts.dryRun === true;
  const out = { reminded: 0, endedNotices: 0, movedToFree: 0, errors: 0, venueIds: { reminded: [] as string[], endedNotices: [] as string[], movedToFree: [] as string[] } };
  const now = Date.now();

  let amountCents = 0;
  try {
    const pro = await resolveVenueProPlan();
    amountCents = typeof pro?.price_monthly_cents === 'number' ? pro.price_monthly_cents : 0;
  } catch { /* the emails leave the price out */ }

  const { data: plans } = await supabaseAdmin.from('directory_plans').select('id, name, slug, is_legacy');
  const legacyPlanIds = new Set(
    ((plans ?? []) as { id: string; name: string | null; slug: string | null; is_legacy: boolean | null }[])
      .filter((p) => p.is_legacy === true || /legacy/i.test(p.name ?? '') || /legacy/i.test(p.slug ?? ''))
      .map((p) => p.id),
  );

  // A second, abandoned sign-up by a paying venue (same name) moves to Free
  // quietly: a "you're on the Free plan" email would alarm a paying client.
  const normName = (n: string | null | undefined) => (n ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const { data: paying } = await supabaseAdmin
    .from('venues')
    .select('name')
    .in('directory_subscription_status', ['active', 'past_due', 'trialing'])
    .not('directory_subscription_external_id', 'is', null);
  const payingNames = new Set(((paying ?? []) as { name: string | null }[]).map((v) => normName(v.name)).filter(Boolean));

  const { data, error } = await supabaseAdmin
    .from('venues')
    .select('id, name, directory_plan_id, directory_trial_ends_at, directory_trial_is_forever, directory_trial_reminder_sent_at, directory_downgrade_at, is_demo, is_suspended')
    .eq('directory_subscription_status', 'trialing')
    .is('directory_subscription_external_id', null)
    .not('directory_trial_ends_at', 'is', null)
    .not('directory_plan_id', 'is', null)
    .limit(500);
  if (error) throw new Error(error.message);

  const { recordStripeBillingEvent } = await import('@/lib/stripe/billing');
  const { notifyVenueTrialEndingNoCard, notifyVenueTrialEndedNoCard } = await import('@/lib/saas-billing-notifications');

  for (const row of (data ?? []) as {
    id: string;
    name: string | null;
    directory_plan_id: string;
    directory_trial_ends_at: string;
    directory_trial_is_forever: boolean | null;
    directory_trial_reminder_sent_at: string | null;
    directory_downgrade_at: string | null;
    is_demo: boolean | null;
    is_suspended: boolean | null;
  }[]) {
    if (row.is_demo || row.is_suspended || row.directory_trial_is_forever || row.directory_downgrade_at) continue;
    if (legacyPlanIds.has(row.directory_plan_id)) continue;
    const endsAt = new Date(row.directory_trial_ends_at).getTime();
    if (!Number.isFinite(endsAt)) continue;
    const quiet = payingNames.has(normName(row.name));

    try {
      if (endsAt > now) {
        if (row.directory_trial_reminder_sent_at || endsAt - now > REMIND_WITHIN_DAYS * DAY_MS) continue;
        const daysLeft = Math.max(1, Math.ceil((endsAt - now) / DAY_MS));
        if (!dry) {
          if (!quiet) await notifyVenueTrialEndingNoCard(row.id, { trialEndsAt: row.directory_trial_ends_at, amountCents, daysLeft });
          await supabaseAdmin.from('venues').update({ directory_trial_reminder_sent_at: new Date().toISOString() }).eq('id', row.id);
        }
        out.reminded += 1;
        out.venueIds.reminded.push(row.id);
        continue;
      }

      if (now - endsAt < NO_CARD_GRACE_DAYS * DAY_MS) {
        const key = `trial_ended_notice:${row.id}:${row.directory_trial_ends_at}`;
        const { data: seen } = await supabaseAdmin.from('platform_billing_events').select('id').eq('external_event_id', key).maybeSingle();
        if (seen) continue;
        out.endedNotices += 1;
        out.venueIds.endedNotices.push(row.id);
        if (dry) continue;
        await recordStripeBillingEvent({
          venueId: row.id, planId: row.directory_plan_id, amountCents: 0, eventType: 'trial_ended_notice',
          externalEventId: key, metadata: { trial_ends_at: row.directory_trial_ends_at },
        });
        if (!quiet) await notifyVenueTrialEndedNoCard(row.id, {
          freeOn: new Date(endsAt + NO_CARD_GRACE_DAYS * DAY_MS).toISOString(),
          amountCents,
        });
        continue;
      }

      out.movedToFree += 1;
      out.venueIds.movedToFree.push(row.id);
      if (!dry) await applyFreeDowngrade(row.id, { notify: !quiet });
    } catch (e) {
      console.error('[no-card-trials] failed', row.id, e);
      out.errors += 1;
    }
  }
  return out;
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
