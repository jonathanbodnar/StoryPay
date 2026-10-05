import { describe, expect, it } from 'vitest';
import { inDays, planNoticeFor, PLAN_NOTICE_FINAL_DAYS, type PlanNoticeInput } from '@/lib/plan-notice';

// What the dashboard says about a plan or trial ending (owner's rules, Oct 5
// 2026). It used to keep one of four bars on every page for the whole trial
// or notice period; the carded-trial one invited a switch to Free on every
// visit. Now it says little until it matters.

const NOW = new Date('2026-10-05T15:00:00Z');
const inDaysFromNow = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString();
const input = (over: Partial<PlanNoticeInput> = {}): PlanNoticeInput => ({
  now: NOW, timeZone: 'America/New_York', planEndsAt: null, canKeepPlan: false,
  trialActive: false, trialEndsAt: null, trialDaysRemaining: 0, trialHasCard: false, trialFreePlan: false, ...over,
});
const trial = (daysLeft: number, over: Partial<PlanNoticeInput> = {}) =>
  input({ trialActive: true, trialEndsAt: inDaysFromNow(daysLeft), trialDaysRemaining: daysLeft, ...over });

describe('a trial with a card on file', () => {
  it('says nothing for most of the trial: no countdown, no "switch to Free" on every page', () => {
    for (const days of [14, 9, PLAN_NOTICE_FINAL_DAYS + 1]) {
      expect(planNoticeFor(trial(days, { trialHasCard: true })), `${days} days left`).toEqual({ kind: 'none' });
    }
  });

  it('gives a heads-up with the charge date in the last days', () => {
    expect(planNoticeFor(trial(3, { trialHasCard: true }))).toEqual({ kind: 'trial-charge-soon', daysLeft: 3, endsOn: 'October 8' });
    expect(planNoticeFor(trial(1, { trialHasCard: true }))).toMatchObject({ kind: 'trial-charge-soon', daysLeft: 1, endsOn: 'October 6' });
  });
});

describe('a trial with no card', () => {
  it('keeps its countdown the whole way: it is a real deadline, and the only prompt to add a card', () => {
    expect(planNoticeFor(trial(12))).toEqual({ kind: 'trial-no-card', daysLeft: 12, endsOn: 'October 17' });
    expect(planNoticeFor(trial(2))).toMatchObject({ kind: 'trial-no-card', daysLeft: 2 });
  });
});

describe('a venue that chose Free during its trial', () => {
  it('sees no countdown: it will not be charged, and locked screens offer the upgrade', () => {
    expect(planNoticeFor(trial(9, { trialFreePlan: true }))).toEqual({ kind: 'none' });
    expect(planNoticeFor(trial(1, { trialFreePlan: true }))).toEqual({ kind: 'none' });
  });
});

describe('a cancelled plan that is still on', () => {
  it('is a quiet notice until the last days, with its date in the venue’s own time zone', () => {
    const notice = planNoticeFor(input({ planEndsAt: '2026-10-27T03:30:00Z', canKeepPlan: true }));
    // 03:30 UTC on the 27th is still the evening of the 26th in New York.
    expect(notice).toEqual({
      kind: 'plan-ending', endsAt: '2026-10-27T03:30:00Z', endsOn: 'October 26', endsOnShort: 'Oct 26', daysLeft: 22, final: false, canKeep: true,
    });
    expect(planNoticeFor(input({ planEndsAt: '2026-10-27T03:30:00Z', timeZone: 'Europe/London' }))).toMatchObject({ endsOn: 'October 27' });
  });

  it('turns into the always-shown notice, with the way to keep the plan, in the last days', () => {
    expect(planNoticeFor(input({ planEndsAt: inDaysFromNow(3.5), canKeepPlan: true }))).toMatchObject({ final: false, daysLeft: 4 });
    expect(planNoticeFor(input({ planEndsAt: inDaysFromNow(3), canKeepPlan: true }))).toMatchObject({ final: true, daysLeft: 3, canKeep: true });
    expect(planNoticeFor(input({ planEndsAt: inDaysFromNow(0.5) }))).toMatchObject({ final: true, daysLeft: 1, canKeep: false });
    // The switch to Free is a timed job: until it runs, the plan "ends today".
    expect(planNoticeFor(input({ planEndsAt: inDaysFromNow(-0.1) }))).toMatchObject({ final: true, daysLeft: 0 });
  });

  it('comes before any trial wording: cancelling a carded trial means nothing will be charged', () => {
    const cancelledTrial = trial(2, { trialHasCard: true, planEndsAt: inDaysFromNow(2), canKeepPlan: true });
    expect(planNoticeFor(cancelledTrial).kind).toBe('plan-ending');
  });
});

describe('everything else', () => {
  it('a paying venue, a legacy venue, a Free venue: nothing', () => {
    expect(planNoticeFor(input())).toEqual({ kind: 'none' });
  });

  it('a date that cannot be read never breaks the dashboard', () => {
    expect(planNoticeFor(input({ planEndsAt: 'not a date' }))).toEqual({ kind: 'none' });
    expect(planNoticeFor(trial(2, { trialHasCard: true, trialEndsAt: 'nonsense' }))).toEqual({ kind: 'trial-charge-soon', daysLeft: 2, endsOn: null });
    expect(planNoticeFor(input({ planEndsAt: inDaysFromNow(10), timeZone: 'Mars/Olympus' })).kind).toBe('plan-ending');
  });

  it('day counts read as a person would say them', () => {
    expect([3, 2, 1, 0, -1].map(inDays)).toEqual(['in 3 days', 'in 2 days', 'tomorrow', 'today', 'today']);
  });
});
