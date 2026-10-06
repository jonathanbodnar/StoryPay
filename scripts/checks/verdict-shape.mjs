/**
 * The record of a checks run, as the runner (scripts/checks/runner.mjs) writes
 * it to the test copy's database and the release scripts read it. Pure, so the
 * fast checks can hold it still (tests/unit/checks-runner.test.ts).
 */

/** Where a commit's run is kept (admin_kv_cache key). */
export const checksKey = (sha) => `checks:${sha}`;
/** The last commit that passed: the next run's "since". */
export const CHECKS_LAST_GREEN = 'checks:last-green';
/** The commit the Checks service is running (or last ran): a newer push replaces a run in progress. */
export const CHECKS_CURRENT = 'checks:current';

/**
 * A run that will never finish because a newer push replaced it: the service
 * has moved on to another commit, whose run answers for this one too.
 * "Moved on" means the other commit's run began AFTER this one's did, or, when
 * this commit has no run yet, after we started waiting for it. (Right after a
 * push the service is still on the commit BEFORE it: that is not a
 * replacement, the new run just hasn't started. Oct 5 2026: mistaking the two
 * sent a whole gate back to the laptop.)
 *
 * `isOlder(other)`: is that other commit an EARLIER one than this? Two pushes
 * a minute apart start two runs, and the earlier push's can start second, for
 * a moment, before the service drops it. That is not a replacement either
 * (Oct 6 2026: the waiter gave up on the newest commit because of it).
 *
 * @param {(other: string) => boolean} [isOlder]
 */
export function replacedBy(row, current, sha, waitingSince = 0, isOlder) {
  const other = current?.value?.sha;
  if (!other || other === sha) return null;
  if (isOlder?.(other)) return null;
  const status = row?.value?.status;
  if (status === 'pass' || status === 'fail') return null;
  const otherBegan = Date.parse(current?.value?.at ?? '');
  const mineBegan = row?.value ? Date.parse(row.value.startedAt ?? '') : waitingSince;
  return Number.isFinite(otherBegan) && Number.isFinite(mineBegan) && otherBegan > mineBegan ? other : null;
}

/** A run that hasn't moved for this long is not coming back (its container was replaced or died). */
export const STALLED_AFTER_MS = 20 * 60_000;

/**
 * What a record says, for the scripts that wait on it:
 *  'pass' | 'fail'      finished
 *  'running'            still going (and heard from recently)
 *  'stalled'            still marked running, but silent too long
 *  'missing'            no run for this commit (yet)
 */
export function verdictOf(row, now = Date.now()) {
  const record = row?.value;
  if (!record || typeof record !== 'object') return 'missing';
  if (record.status === 'pass') return Array.isArray(record.results) && record.results.every(([, ok]) => ok === true) ? 'pass' : 'fail';
  if (record.status === 'fail') return 'fail';
  const heard = Date.parse(row.updated_at ?? record.startedAt ?? '');
  return Number.isFinite(heard) && now - heard < STALLED_AFTER_MS ? 'running' : 'stalled';
}

/** The summary printed at the end of a run and by the scripts that read it. */
export function summarize(record) {
  const lines = [];
  for (const [name, ok, seconds] of record?.results ?? []) {
    const again = (record.reruns ?? []).find((r) => r.stage === name);
    const took = typeof seconds === 'number' ? `  ${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s` : '';
    lines.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${took}${again ? `  (needed a second run: ${again.files.join(', ')})` : ''}`);
  }
  return lines.join('\n');
}

/** The record check-deploy.mjs keeps on this computer, which release.mjs reads. */
export function localRecord(record, at = new Date().toISOString()) {
  const results = (record?.results ?? []).map(([name, ok]) => [name, ok === true]);
  return {
    sha: record.sha,
    pass: record.status === 'pass' && results.length > 0 && results.every(([, ok]) => ok),
    lane: record.lane ?? 'full',
    changed: record.changed ?? null,
    slept: 0,
    reruns: record.reruns ?? [],
    at,
    results,
    ranOn: 'checks service',
    since: record.base ?? null,
  };
}
