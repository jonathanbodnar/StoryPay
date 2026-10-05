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
 * A fix released hot over a red release is checked for both: the check
 * compares against the last version whose own check passed, and a pass
 * marks the red one resolved.
 *
 *   node scripts/staging/trailing-check.mjs <sha>
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { trailingBase } from './lanes.mjs';

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const sha = git('rev-parse', process.argv[2] || 'HEAD');
const short = sha.slice(0, 8);
const checksDir = join(git('rev-parse', '--git-dir'), 'storyvenue-checks');
const hotFile = join(checksDir, `hot-${sha}.json`);
const hotRecord = (s) => {
  try { return JSON.parse(readFileSync(join(checksDir, `hot-${s}.json`), 'utf8')); } catch { return null; }
};
if (!existsSync(hotFile)) {
  console.error(`${short} wasn't released hot (no ${hotFile}). Nothing to trail.`);
  process.exit(1);
}
const hot = JSON.parse(readFileSync(hotFile, 'utf8'));

console.log(`Trailing check for hot release ${short} (previous version on standby: ${String(hot.prevSha).slice(0, 8)})…`);
// The commit is already live, so "what changed" is everything since the
// version it replaced (or since the last one that passed, when this is a fix
// over a red release): that decides the lane and the tests that run first.
const { base, superseded } = trailingBase(hot.prevSha, hotRecord);
if (superseded.length) {
  console.log(`It went out over ${superseded.map((s) => s.slice(0, 8)).join(', ')}, whose own check didn't pass: checking everything since ${String(base).slice(0, 8)}.`);
}
let since = [];
try {
  git('cat-file', '-e', `${base}^{commit}`);
  since = ['--since', base];
} catch { /* unknown previous version: the full suite, nothing singled out */ }
const startedAt = Date.now();
const check = spawnSync('node', ['scripts/staging/check-deploy.mjs', sha, ...since], { stdio: 'inherit' });

// A newer push took over the Checks service: that release's trailing check
// compares against the last version that passed, so it answers for this one.
if (check.status === 4) {
  writeFileSync(hotFile, JSON.stringify({ ...hot, trailing: 'superseded', trailingAt: new Date().toISOString(), since: base }, null, 1));
  console.log(`\nTrailing check for ${short}: replaced by a newer push. Run the newest release's trailing check; it covers this one.`);
  process.exit(0);
}
const pass = check.status === 0;
// The check's own record of this run (not an older one) says whether the computer slept through it.
let slept = 0;
try {
  const record = JSON.parse(readFileSync(join(git('rev-parse', '--git-dir'), 'storyvenue-checks', `${sha}.json`), 'utf8'));
  if (Date.parse(record.at) >= startedAt) slept = Number(record.slept) || 0;
} catch { /* no record: the check was cut short */ }
const trailing = pass ? 'pass' : slept ? 'interrupted' : 'fail';
writeFileSync(hotFile, JSON.stringify({ ...hot, trailing, trailingAt: new Date().toISOString(), since: base }, null, 1));
if (pass) {
  // The red releases this one went out over are answered for.
  for (const s of superseded) {
    writeFileSync(join(checksDir, `hot-${s}.json`), JSON.stringify({ ...hotRecord(s), resolvedBy: sha }, null, 1));
  }
  console.log(`\nTrailing check PASSED — the hot release ${short} stands${superseded.length ? `, and it resolves ${superseded.map((s) => s.slice(0, 8)).join(', ')}` : ''}.`);
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
