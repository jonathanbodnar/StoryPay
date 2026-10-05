import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain logic module shared with the checks runner and the release scripts
import { CHECKS_CURRENT, CHECKS_LAST_GREEN, checksKey, localRecord, replacedBy, STALLED_AFTER_MS, summarize, verdictOf } from '../../scripts/checks/verdict-shape.mjs';

// The full check runs on Railway (the "Checks" service), not on a laptop, and
// leaves its verdict in the test copy's database. These are the rules for
// reading that verdict: a release goes by them.
const SHA = 'a'.repeat(40);
const NOW = Date.parse('2026-10-05T18:00:00Z');
const row = (value: Record<string, unknown>, minutesAgo = 1) => ({ value, updated_at: new Date(NOW - minutesAgo * 60_000).toISOString() });
const passed = { sha: SHA, status: 'pass', lane: 'full', base: 'b'.repeat(40), changed: 4, results: [['type check', true, 41], ['flow tests', true, 1040], ['browser tests', true, 262]], reruns: [] };

describe('reading the Checks service’s verdict', () => {
  it('a finished run passed only if every stage did', () => {
    expect(verdictOf(row(passed), NOW)).toBe('pass');
    expect(verdictOf(row({ ...passed, status: 'fail', results: [['type check', true], ['flow tests', false]] }), NOW)).toBe('fail');
    // "pass" written over a failed stage is still a failure.
    expect(verdictOf(row({ ...passed, results: [['type check', true], ['flow tests', false]] }), NOW)).toBe('fail');
  });

  it('a run in progress is waited for, until it has been silent too long', () => {
    const running = { sha: SHA, status: 'running', stage: 'flow tests', startedAt: new Date(NOW - 12 * 60_000).toISOString(), results: [['type check', true, 40]] };
    expect(verdictOf(row(running, 1), NOW)).toBe('running');
    // A newer push replaced its container, or it died: nothing more is coming.
    expect(verdictOf(row(running, STALLED_AFTER_MS / 60_000 + 1), NOW)).toBe('stalled');
  });

  it('no run, or something that isn’t one, is "missing": the caller runs the checks itself', () => {
    for (const nothing of [null, undefined, {}, { value: null }, { value: 'pass' }]) expect(verdictOf(nothing, NOW)).toBe('missing');
  });

  it('a run replaced by a newer push is not waited for, and not run again here: the newer run covers it', () => {
    const newer = 'c'.repeat(40);
    const current = { value: { sha: newer } };
    const running = row({ sha: SHA, status: 'running', stage: 'flow tests', startedAt: new Date(NOW).toISOString(), results: [] });
    expect(replacedBy(running, current, SHA)).toBe(newer);
    expect(replacedBy(null, current, SHA)).toBe(newer); // it never even started
    // Its own run is the current one, or it finished: nothing replaced it.
    expect(replacedBy(running, { value: { sha: SHA } }, SHA)).toBeNull();
    expect(replacedBy(row(passed), current, SHA)).toBeNull();
    expect(replacedBy(row({ ...passed, status: 'fail' }), current, SHA)).toBeNull();
    expect(replacedBy(running, null, SHA)).toBeNull();
    expect(CHECKS_CURRENT).not.toBe(CHECKS_LAST_GREEN);
  });

  it('each commit has its own record, apart from the last one that passed', () => {
    expect(checksKey(SHA)).toBe(`checks:${SHA}`);
    expect(CHECKS_LAST_GREEN).not.toBe(checksKey('last-green-looking-sha'));
  });
});

describe('what the release script is told', () => {
  it('a passing run becomes a passing record, with what needed a second run kept', () => {
    const reruns = [{ stage: 'flow tests', files: ['tests/flows/lead-sources.test.ts'] }];
    const mine = localRecord({ ...passed, reruns }, '2026-10-05T18:00:00.000Z');
    expect(mine).toMatchObject({ sha: SHA, pass: true, lane: 'full', changed: 4, ranOn: 'checks service', since: 'b'.repeat(40), reruns });
    expect(mine.results).toEqual([['type check', true], ['flow tests', true], ['browser tests', true]]);
  });

  it('anything short of a clean pass is not released', () => {
    expect(localRecord({ ...passed, status: 'fail' }).pass).toBe(false);
    expect(localRecord({ ...passed, status: 'running' }).pass).toBe(false);
    expect(localRecord({ ...passed, results: [] }).pass).toBe(false);
    expect(localRecord({ ...passed, results: [['flow tests', 'yes']] }).pass).toBe(false);
  });

  it('the summary shows each stage, how long it took, and what needed a second run', () => {
    const text = summarize({ ...passed, results: [['flow tests', true, 1040], ['browser tests', false, 62]], reruns: [{ stage: 'flow tests', files: ['tests/flows/a.test.ts'] }] });
    expect(text.split('\n')).toEqual([
      'PASS  flow tests  17m20s  (needed a second run: tests/flows/a.test.ts)',
      'FAIL  browser tests  1m02s',
    ]);
  });
});

describe('the runner itself', () => {
  const source = readFileSync(join(__dirname, '..', '..', 'scripts', 'checks', 'runner.mjs'), 'utf8');

  it('refuses to run anywhere but the test copy', () => {
    expect(source).toContain("e.APP_ENV !== 'staging'");
    expect(source).toContain('includes(LIVE_SUPABASE_REF)');
    expect(source).toMatch(/storyvenue\\\.com\|storypay\\\.io/);
  });

  it('starts only after everything it uses is defined', () => {
    // The kick-off is the last statement of the file (it once ran before `db` existed).
    expect(source.lastIndexOf('run().catch(')).toBeGreaterThan(source.lastIndexOf('async function run()'));
    expect(source.lastIndexOf('run().catch(')).toBeGreaterThan(source.indexOf('const db = '));
  });
});
