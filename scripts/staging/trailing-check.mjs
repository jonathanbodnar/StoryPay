#!/usr/bin/env node
/**
 * The hot lane's safety net: after `release.mjs <sha> --hot` puts a commit
 * live, this runs the FULL check against the test copy (check-deploy.mjs)
 * and records the verdict on the hot release.
 *
 * On a failure it does NOT undo anything by itself — the owner's call
 * (2026-10-03) is fix-forward: the change stays live and usable while the
 * fix is written and hot-released over it. When the fix isn't quick or the
 * failure is hurting real pages, put the previous version back in about a
 * minute with: node scripts/staging/rollback.mjs <sha>
 *
 * A run this computer slept through (a closed lid) fails for that reason
 * alone; it is recorded as 'interrupted', not 'fail', and has to be run again.
 *
 *   node scripts/staging/trailing-check.mjs <sha>
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const sha = git('rev-parse', process.argv[2] || 'HEAD');
const short = sha.slice(0, 8);
const hotFile = join(git('rev-parse', '--git-dir'), 'storyvenue-checks', `hot-${sha}.json`);
if (!existsSync(hotFile)) {
  console.error(`${short} wasn't released hot (no ${hotFile}). Nothing to trail.`);
  process.exit(1);
}
const hot = JSON.parse(readFileSync(hotFile, 'utf8'));

console.log(`Trailing check for hot release ${short} (previous version on standby: ${String(hot.prevSha).slice(0, 8)})…`);
// The commit is already live, so "what changed" is everything since the
// version it replaced: that's what picks the changed area's tests to run first.
let since = [];
try {
  git('cat-file', '-e', `${hot.prevSha}^{commit}`);
  since = ['--since', hot.prevSha];
} catch { /* unknown previous version: the full suite, nothing singled out */ }
const startedAt = Date.now();
const check = spawnSync('node', ['scripts/staging/check-deploy.mjs', sha, ...since], { stdio: 'inherit' });

const pass = check.status === 0;
// The check's own record of this run (not an older one) says whether the computer slept through it.
let slept = 0;
try {
  const record = JSON.parse(readFileSync(join(git('rev-parse', '--git-dir'), 'storyvenue-checks', `${sha}.json`), 'utf8'));
  if (Date.parse(record.at) >= startedAt) slept = Number(record.slept) || 0;
} catch { /* no record: the check was cut short */ }
const trailing = pass ? 'pass' : slept ? 'interrupted' : 'fail';
writeFileSync(hotFile, JSON.stringify({ ...hot, trailing, trailingAt: new Date().toISOString() }, null, 1));
if (pass) {
  console.log(`\nTrailing check PASSED — the hot release ${short} stands.`);
  process.exit(0);
}
if (trailing === 'interrupted') {
  console.error(`\nTrailing check INTERRUPTED: this computer slept ${slept} time${slept === 1 ? '' : 's'} during the run, so it says nothing about ${short}.`);
  console.error(`Run it again with the computer awake: node scripts/staging/trailing-check.mjs ${short}`);
  process.exit(2);
}
console.error(`\nTrailing check FAILED while ${short} is live.`);
console.error('Fix it and release the fix hot (fix-forward), or put the previous version back in about a minute:');
console.error(`  node scripts/staging/rollback.mjs ${short}`);
process.exit(1);
