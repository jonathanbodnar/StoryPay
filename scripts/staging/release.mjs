#!/usr/bin/env node
/**
 * Put a commit live: move the `production` branch to it, then wait for the
 * live site to finish deploying it. Only forward (a commit already on main
 * and newer than what's live), two ways:
 *
 *   node scripts/staging/release.mjs <sha>          # after a full check pass
 *   node scripts/staging/release.mjs <sha> --hot    # straight to live
 *
 * --hot is the everyday lane (owner's call, 2026-10-03): live in about the
 * build time, with the full check trailing right behind it —
 * scripts/staging/trailing-check.mjs runs the whole suite against the test
 * copy and ROLLS PRODUCTION BACK to the release's recorded previous deploy
 * if anything fails. Hot refuses the sensitive areas (payments, texting,
 * sign-in, migrations — scripts/staging/lanes.mjs), which always take the
 * full gate: a wrong charge or text can't be rolled back.
 *
 *   node scripts/staging/release.mjs <sha> --skip-checks   # emergencies, only when the owner says so
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sensitiveFiles } from './lanes.mjs';

const args = process.argv.slice(2);
const skipChecks = args.includes('--skip-checks');
const hot = args.includes('--hot');
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const sha = git('rev-parse', args.find((a) => !a.startsWith('--')) || 'HEAD');
const short = sha.slice(0, 8);
const railwayEnv = { ...process.env, RAILWAY_CALLER: 'skill:use-railway@1.5.5' };

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

try {
  execFileSync('git', ['fetch', '-q', 'origin', 'main', 'production'], { stdio: 'ignore' });
} catch {
  fail('No production branch yet: run node scripts/staging/setup-gate.mjs once first.');
}

const checksDir = join(git('rev-parse', '--git-dir'), 'storyvenue-checks');

if (hot) {
  // The sensitive areas always take the full gate.
  const changed = git('diff', '--name-only', 'origin/production', sha).split('\n').filter(Boolean);
  const sensitive = sensitiveFiles(changed);
  if (sensitive.length) {
    fail(`Not going hot: this release touches ${sensitive.length} sensitive file(s) (payments/texting/sign-in/database):\n  ${sensitive.join('\n  ')}\nRun the full gate: node scripts/staging/check-deploy.mjs ${short}`);
  }
} else if (!skipChecks) {
  const record = join(checksDir, `${sha}.json`);
  const passed = existsSync(record) && JSON.parse(readFileSync(record, 'utf8')).pass === true;
  if (!passed) fail(`${short} hasn't passed the checks here. Run: node scripts/staging/check-deploy.mjs ${short}`);
}

const onMain = () => { try { git('merge-base', '--is-ancestor', sha, 'origin/main'); return true; } catch { return false; } };
const forward = () => { try { git('merge-base', '--is-ancestor', 'origin/production', sha); return true; } catch { return false; } };
if (!onMain()) fail(`${short} isn't on main. Push it to main first (the test copy checks main).`);
if (git('rev-parse', 'origin/production') === sha) fail(`${short} is already live.`);
if (!forward()) fail(`${short} is older than what's live (or not after it). Nothing released.`);

function liveDeployments() {
  const out = execFileSync('railway', ['deployment', 'list', '--service', 'StoryVenue Backend', '--environment', 'production', '--json'], { env: railwayEnv, encoding: 'utf8' });
  const list = JSON.parse(out);
  return Array.isArray(list) ? list : list.deployments ?? [];
}

// A hot release remembers what was live, so the trailing check can put it
// back in about a minute if the suite finds a problem.
if (hot) {
  const prev = liveDeployments().find((d) => d.status === 'SUCCESS');
  if (!prev?.id) fail('Not going hot: could not read the current live deployment (needed for rollback).');
  mkdirSync(checksDir, { recursive: true });
  writeFileSync(join(checksDir, `hot-${sha}.json`), JSON.stringify({
    sha, at: new Date().toISOString(),
    prevDeploymentId: prev.id, prevSha: String(prev.meta?.commitHash ?? ''),
  }, null, 1));
}

execFileSync('git', ['push', 'origin', `${sha}:refs/heads/production`], { stdio: 'inherit' });
console.log(`production → ${short}${hot ? ' (hot: full check trails, rollback armed)' : skipChecks ? ' (checks skipped)' : ''}. Waiting for the live site…`);

const liveStatus = () => liveDeployments().find((d) => String(d.meta?.commitHash ?? '').startsWith(short))?.status ?? 'NOT_STARTED';
const until = Date.now() + 20 * 60_000;
let status = liveStatus();
process.stdout.write(`Live deploy of ${short}: ${status}`);
while (!['SUCCESS', 'FAILED', 'CRASHED', 'REMOVED'].includes(status)) {
  if (Date.now() > until) fail('\nGave up waiting after 20 minutes; check Railway.');
  await new Promise((r) => setTimeout(r, 20_000));
  status = liveStatus();
  process.stdout.write(` → ${status}`);
}
console.log('');
if (status !== 'SUCCESS') fail(status === 'REMOVED' ? 'A newer release replaced this one.' : 'The live deploy failed; the previous version keeps running. Check Railway.');
console.log(`${short} is live.`);
if (hot) console.log(`Now run the trailing check: node scripts/staging/trailing-check.mjs ${short}`);
