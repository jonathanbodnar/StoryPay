/**
 * Shared metadata for the Booking System (Speed to Lead) automation sequences.
 *
 * Pure constants — safe to import from both server routes and client
 * components. The `marketing_automations.name` values here are the single
 * source of truth used to identify a venue's booking-system sequences across
 * the app (each venue has its own automation row sharing these names).
 */

export const STL_NAME     = 'Speed to Lead — Booking System';
export const PHASE4_NAME  = 'Booked Tour Sequence — Booking System';
export const PHASE5_NAME  = 'Booked Wedding Sequence — Booking System';
export const PHASE6_NAME  = 'Anniversary — Booking System';

export type SequencePhaseKey = 'phase2' | 'phase4' | 'phase5' | 'phase6';

export interface SequencePhaseMeta {
  key: SequencePhaseKey;
  automationName: string;
  /** Matches the sub-account Speed to Lead page section titles. */
  title: string;
  subtitle: string;
}

export const SEQUENCE_PHASES: SequencePhaseMeta[] = [
  {
    key: 'phase2',
    automationName: STL_NAME,
    title: 'Guide Delivered → 14-Day Sequence',
    subtitle: 'SMS nurture that runs for two weeks after the guide is sent, until she replies.',
  },
  {
    key: 'phase4',
    automationName: PHASE4_NAME,
    title: 'Booked Tour → Toured',
    subtitle: 'Fires when a lead is moved to the Tour Booked stage.',
  },
  {
    key: 'phase5',
    automationName: PHASE5_NAME,
    title: 'Wedding Day → Welcomed',
    subtitle: 'Fires when a lead is moved to the Wedding Booked stage.',
  },
  {
    key: 'phase6',
    automationName: PHASE6_NAME,
    title: 'Anniversary → Celebrated',
    subtitle: 'A single email one year after the wedding date.',
  },
];

export const SEQUENCE_PHASE_BY_KEY: Record<SequencePhaseKey, SequencePhaseMeta> =
  Object.fromEntries(SEQUENCE_PHASES.map((p) => [p.key, p])) as Record<SequencePhaseKey, SequencePhaseMeta>;

export function automationNameForPhase(key: string): string | null {
  return SEQUENCE_PHASE_BY_KEY[key as SequencePhaseKey]?.automationName ?? null;
}
