import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — a plain script module, shared with scripts/staging/tidy.mjs
import { LEFTOVER_AFTER_MS, leftoverUser, leftoverVenue, runTime } from '../../scripts/staging/tidy-rule.mjs';

// The test copy filled up with what test runs left behind: 855 venues by Oct 6
// 2026, about a hundred more with every run. Whole-database jobs slowed with
// it until the nightly tag sweep took 68 seconds there and failed the checks.
// Every run now starts by clearing out the runs before it. This is the rule
// for what may go: a mistake here deletes a fixture every other test needs,
// or something a run in progress has just made.

const NOW = Date.parse('2026-10-06T16:00:00Z');
const id = (msAgo: number) => (NOW - msAgo).toString(36);
const HOUR = 3_600_000;

describe('what counts as a leftover on the test copy', () => {
  it('a run id is the time a run started; ordinary words and numbers are not one', () => {
    expect(runTime(id(0), NOW)).toBe(NOW);
    expect(runTime(id(5 * 24 * HOUR), NOW)).toBe(NOW - 5 * 24 * HOUR);
    // Nothing from before the test copy existed (September 2026) is a run.
    expect(runTime(Date.parse('2026-08-27T00:00:00Z').toString(36), NOW)).toBeNull();
    for (const word of ['venue', 'barn', 'journey', 'estate', 'flow', 'example', '12125550188', 'zzzzzzzz', '00000001', 'a7f10000', 'MUWWU34M', '', null, 7]) {
      expect(runTime(word as string, NOW), String(word)).toBeNull();
    }
    // A time from next week isn't a run that happened.
    expect(runTime((NOW + 7 * 24 * HOUR).toString(36), NOW)).toBeNull();
  });

  it('a venue made by a run that is over goes', () => {
    const old = id(5 * HOUR);
    expect(leftoverVenue({ name: `Guide Journey ${old}`, slug: `guide-journey-desktop-${id(5 * HOUR - 4000)}`, email: `guide.desktop-${id(5 * HOUR - 4000)}.${old}@example.com` }, NOW)).toBe(true);
    expect(leftoverVenue({ name: `Billing Test ${old}`, slug: null, email: `billing.${old}@example.com` }, NOW)).toBe(true);
    // A venue the signup page made: the run id is only in its email.
    expect(leftoverVenue({ name: 'Signup Barn', slug: 'signup-barn', email: `signup.${old}@example.com` }, NOW)).toBe(true);
  });

  it('one a run made in the last two hours stays: that run may still be going', () => {
    const fresh = id(20 * 60_000);
    expect(leftoverVenue({ name: `Guide Journey ${fresh}`, slug: `guide-journey-${fresh}`, email: `guide.${fresh}@example.com` }, NOW)).toBe(false);
    expect(leftoverVenue({ name: `Guide Journey ${id(LEFTOVER_AFTER_MS - 1000)}`, slug: null, email: `g.${id(LEFTOVER_AFTER_MS - 1000)}@example.com` }, NOW)).toBe(false);
    expect(leftoverVenue({ name: `Guide Journey ${id(LEFTOVER_AFTER_MS + 1000)}`, slug: null, email: `g.${id(LEFTOVER_AFTER_MS + 1000)}@example.com` }, NOW)).toBe(true);
    // An old run id in the name and a new one in the email (something reused): the newest decides.
    expect(leftoverVenue({ name: `Guide Barn ${id(9 * HOUR)}`, slug: null, email: `g.${fresh}@example.com` }, NOW)).toBe(false);
  });

  it('the fixed accounts and the seeded venues never go, however old', () => {
    for (const venue of [
      { name: 'Flow Test Venue', slug: 'flow-test-venue', email: 'flow-owner@example.com' },
      { name: 'Flow Suspended Venue', slug: 'flow-suspended-venue', email: 'flow-suspended@example.com' },
      { name: 'Willow Creek Estate', slug: 'willow-creek-estate', email: 'hello@example.com' },
      { name: 'Juniper Ridge Barn', slug: 'juniper-ridge-barn', email: 'juniper@example.com' },
      { name: 'Maple Hollow Barn (Test)', slug: 'maple-hollow-test', email: 'owner@storyvenue.com' },
    ]) expect(leftoverVenue(venue, NOW), venue.name).toBe(false);
  });

  it('a real-looking address is never a leftover, whatever its name says', () => {
    const old = id(50 * HOUR);
    expect(leftoverVenue({ name: `Guide Journey ${old}`, slug: null, email: `someone.${old}@gmail.com` }, NOW)).toBe(false);
    expect(leftoverUser(`someone.${old}@gmail.com`, NOW)).toBe(false);
  });

  it('a run id at the end of a longer word counts too', () => {
    expect(leftoverUser(`morgan.livephone${id(5 * HOUR)}@example.com`, NOW)).toBe(true);
    expect(leftoverUser(`morgan.livephone${id(10 * 60_000)}@example.com`, NOW)).toBe(false);
    // The seeded leads and the showcase couple have ordinary names, long ones too.
    for (const fixed of ['avery.thompson@example.com', 'casey.bennett@example.com', 'emma.sinclair@example.com', 'camille.rousseau@example.com', 'flowsuperadministrator@example.com']) {
      expect(leftoverUser(fixed, NOW), fixed).toBe(false);
    }
  });

  it('sign-ins follow the same rule', () => {
    expect(leftoverUser(`reset.couple.${id(5 * HOUR)}@example.com`, NOW)).toBe(true);
    expect(leftoverUser(`reset.couple.${id(10 * 60_000)}@example.com`, NOW)).toBe(false);
    for (const fixed of ['flow-sweep-couple@example.com', 'flow-owner@example.com', 'flow-superadmin@example.com', 'emma.sinclair@example.com']) {
      expect(leftoverUser(fixed, NOW), fixed).toBe(false);
    }
  });
});
