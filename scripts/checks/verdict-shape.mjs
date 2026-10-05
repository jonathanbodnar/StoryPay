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
 * A run that will never finish because a newer push replaced it: its record
 * is unfinished (or was never written) and the service has moved on to
 * another commit, whose run answers for this one too.
 */
export function replacedBy(row, current, sha) {
  const other = current?.value?.sha;
  if (!other || other === sha) return null;
  const status = row?.value?.status;
  return status === 'pass' || status === 'fail' ? null : other;
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
