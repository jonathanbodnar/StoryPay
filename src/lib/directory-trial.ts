/**
 * Directory plan trial period logic.
 *
 * Plans configure a trial duration (e.g. 14 days, 1 month, forever, or none).
 * When a venue first signs up to a paid plan, the plan's trial config is
 * SNAPSHOTTED onto the venue: directory_trial_ends_at + directory_trial_plan_id
 * are set, and directory_trial_consumed flips TRUE. Future admin edits to the
 * plan's trial fields only affect subsequent signups — existing trials stay
 * exactly as granted.
 *
 * A "forever" trial means the venue uses the paid plan free indefinitely and
 * is never auto-billed.
 */

export const TRIAL_UNITS = ['none', 'days', 'weeks', 'months', 'years', 'forever'] as const;
export type TrialUnit = (typeof TRIAL_UNITS)[number];

export type PlanTrialConfig = {
  trial_period_value: number | null | undefined;
  trial_period_unit: TrialUnit | string | null | undefined;
};

export type VenueTrialState = {
  /** ISO string when the trial started, or null if never trialed. */
  directory_trial_started_at: string | null;
  /** ISO string when trial ends; null when no trial OR forever-trial. */
  directory_trial_ends_at: string | null;
  /** Forever-trial flag — when TRUE the venue is never auto-billed. */
  directory_trial_is_forever: boolean;
  /** Plan id that granted the trial (may differ from current directory_plan_id). */
  directory_trial_plan_id: string | null;
  /** TRUE once a trial has been granted, prevents re-granting. */
  directory_trial_consumed: boolean;
};

/** Coerce arbitrary unit strings to a known TrialUnit, defaulting to 'none'. */
export function coerceTrialUnit(unit: string | null | undefined): TrialUnit {
  if (!unit) return 'none';
  const u = String(unit).toLowerCase().trim();
  if ((TRIAL_UNITS as readonly string[]).includes(u)) return u as TrialUnit;
  return 'none';
}

/** Does this plan offer a real trial (any duration > 0 OR forever)? */
export function planHasTrial(p: PlanTrialConfig): boolean {
  const unit = coerceTrialUnit(p.trial_period_unit);
  if (unit === 'none') return false;
  if (unit === 'forever') return true;
  const value = typeof p.trial_period_value === 'number' ? p.trial_period_value : 0;
  return value > 0;
}

/**
 * Compute when a trial would END given a plan and a starting timestamp.
 *
 * Returns:
 *   • { endsAt: Date, forever: false }   for finite trials
 *   • { endsAt: null, forever: true }    for "forever" trials
 *   • { endsAt: null, forever: false }   when the plan has no trial
 */
export function computeTrialEnd(
  p: PlanTrialConfig,
  from: Date = new Date(),
): { endsAt: Date | null; forever: boolean } {
  const unit = coerceTrialUnit(p.trial_period_unit);
  if (unit === 'none') return { endsAt: null, forever: false };
  if (unit === 'forever') return { endsAt: null, forever: true };

  const value = typeof p.trial_period_value === 'number' ? p.trial_period_value : 0;
  if (value <= 0) return { endsAt: null, forever: false };

  const d = new Date(from);
  switch (unit) {
    case 'days':
      d.setDate(d.getDate() + value);
      break;
    case 'weeks':
      d.setDate(d.getDate() + 7 * value);
      break;
    case 'months':
      d.setMonth(d.getMonth() + value);
      break;
    case 'years':
      d.setFullYear(d.getFullYear() + value);
      break;
  }
  return { endsAt: d, forever: false };
}

/**
 * Display the trial duration as a marketing string.
 *   • 14 days        → "14-day free trial"
 *   • 1 month        → "1-month free trial"
 *   • forever        → "Free forever"
 *   • none / 0 days  → ""
 *
 * Compound adjective form (singular unit) reads better than "14-days free trial".
 */
export function formatTrialDuration(p: PlanTrialConfig): string {
  const unit = coerceTrialUnit(p.trial_period_unit);
  if (unit === 'none') return '';
  if (unit === 'forever') return 'Free forever';
  const value = typeof p.trial_period_value === 'number' ? p.trial_period_value : 0;
  if (value <= 0) return '';
  const singular = unit.replace(/s$/, ''); // days → day
  return `${value}-${singular} free trial`;
}

/**
 * Days remaining in an active trial, rounded UP so partial days still display
 * as 1 instead of 0. Returns 0 for already-expired trials and Infinity for
 * forever-trials so callers can render a permanent "Free forever" pill.
 */
export function daysRemainingInTrial(state: VenueTrialState, now: Date = new Date()): number {
  if (state.directory_trial_is_forever) return Infinity;
  if (!state.directory_trial_ends_at) return 0;
  const ends = new Date(state.directory_trial_ends_at);
  if (Number.isNaN(ends.getTime())) return 0;
  const diffMs = ends.getTime() - now.getTime();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

export type TrialStatus = 'none' | 'active' | 'forever' | 'expired';

export function deriveTrialStatus(state: VenueTrialState, now: Date = new Date()): TrialStatus {
  if (state.directory_trial_is_forever) return 'forever';
  if (!state.directory_trial_ends_at) {
    return state.directory_trial_consumed ? 'expired' : 'none';
  }
  const ends = new Date(state.directory_trial_ends_at);
  if (Number.isNaN(ends.getTime())) return 'none';
  return ends.getTime() > now.getTime() ? 'active' : 'expired';
}

/**
 * Extract the trial config from a plan row. Tolerates rows where the migration
 * hasn't run yet by defaulting to "no trial".
 */
export function readPlanTrialConfig(planRow: Record<string, unknown> | null | undefined): PlanTrialConfig {
  if (!planRow) return { trial_period_value: 0, trial_period_unit: 'none' };
  return {
    trial_period_value:
      typeof planRow.trial_period_value === 'number' ? (planRow.trial_period_value as number) : 0,
    trial_period_unit: coerceTrialUnit(planRow.trial_period_unit as string | null | undefined),
  };
}
