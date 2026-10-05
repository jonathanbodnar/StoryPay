/**
 * What the dashboard says about a venue's plan or trial ending (owner's
 * rules, Oct 5 2026). Before this, one of four bars sat on every dashboard
 * page for the whole trial or notice period; the carded-trial one read
 * "Switch to Free anytime before then" on every visit.
 *
 *  - Trial, card on file: nothing until the last days, then a one-line
 *    heads-up with the charge date (the same window as the heads-up email
 *    from lib/trial-sweep.ts). The date is always on the plan page.
 *  - Trial, chose Free: nothing. They won't be charged, and the locked
 *    screens are where an upgrade is offered.
 *  - Cancelled, plan still on: shown once after cancelling, then as a small
 *    chip on the Setup guide bar, then again in the last days with a way
 *    to keep the plan.
 *  - Trial, no card: the countdown stays. It's a real deadline, and the only
 *    prompt to add a card.
 *
 * Pure, and worked out on the server (the dashboard layout), so the page and
 * its first paint agree on dates and day counts.
 */

/** The last days before a plan or trial ends, when the dashboard says so. */
export const PLAN_NOTICE_FINAL_DAYS = 3;

const DAY_MS = 86_400_000;

export interface PlanNoticeInput {
  now: Date;
  /** The venue's time zone, for the dates shown. */
  timeZone: string;
  /** The venue cancelled: its plan stays on until this ISO moment, then it moves to Free. */
  planEndsAt: string | null;
  /** The pending cancel can still be undone ("Keep my plan" on the plan page). */
  canKeepPlan: boolean;
  /** On a trial that hasn't run out (or inside its window after choosing Free). */
  trialActive: boolean;
  trialEndsAt: string | null;
  /** Whole days left in the trial, rounded up. */
  trialDaysRemaining: number;
  /** A card is on file: the trial charges it at the end. */
  trialHasCard: boolean;
  /** The venue chose Free during its trial window. */
  trialFreePlan: boolean;
}

export type PlanNotice =
  | { kind: 'none' }
  /**
   * Cancelled, plan still on. `final` = the last days: always shown, with the
   * way to keep the plan. Before that it's shown once after cancelling
   * (lib/plan-notice-client.ts) and as a chip on the Setup guide bar.
   */
  | { kind: 'plan-ending'; endsAt: string; endsOn: string; endsOnShort: string; daysLeft: number; final: boolean; canKeep: boolean }
  /** Trial with no card: the countdown and "add a card" prompt, always shown. */
  | { kind: 'trial-no-card'; daysLeft: number; endsOn: string | null }
  /** Trial with a card on file, last days only: the heads-up before the first charge. */
  | { kind: 'trial-charge-soon'; daysLeft: number; endsOn: string | null };

function dayLabel(iso: string | null, timeZone: string, month: 'long' | 'short'): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  try {
    return new Intl.DateTimeFormat('en-US', { month, day: 'numeric', timeZone }).format(at);
  } catch {
    return new Intl.DateTimeFormat('en-US', { month, day: 'numeric', timeZone: 'UTC' }).format(at);
  }
}

export function planNoticeFor(input: PlanNoticeInput): PlanNotice {
  const now = input.now.getTime();

  // A cancelled plan comes first: whatever trial it was on, nothing will be charged.
  const endsOn = dayLabel(input.planEndsAt, input.timeZone, 'long');
  if (input.planEndsAt && endsOn) {
    const left = new Date(input.planEndsAt).getTime() - now;
    return {
      kind: 'plan-ending',
      endsAt: input.planEndsAt,
      endsOn,
      endsOnShort: dayLabel(input.planEndsAt, input.timeZone, 'short') ?? endsOn,
      daysLeft: Math.max(0, Math.ceil(left / DAY_MS)),
      final: left <= PLAN_NOTICE_FINAL_DAYS * DAY_MS,
      canKeep: input.canKeepPlan,
    };
  }

  if (!input.trialActive || input.trialFreePlan) return { kind: 'none' };
  const daysLeft = Math.max(0, Math.floor(input.trialDaysRemaining));
  const trialEndsOn = dayLabel(input.trialEndsAt, input.timeZone, 'long');
  if (!input.trialHasCard) return { kind: 'trial-no-card', daysLeft, endsOn: trialEndsOn };
  if (daysLeft <= PLAN_NOTICE_FINAL_DAYS) return { kind: 'trial-charge-soon', daysLeft, endsOn: trialEndsOn };
  return { kind: 'none' };
}

/** "in 2 days", "tomorrow", "today": how a day count reads in a sentence. */
export function inDays(daysLeft: number): string {
  if (daysLeft <= 0) return 'today';
  if (daysLeft === 1) return 'tomorrow';
  return `in ${daysLeft} days`;
}
