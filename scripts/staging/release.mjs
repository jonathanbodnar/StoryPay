#!/usr/bin/env node
/**
 * Put a commit live: move the `production` branch to it, then wait for the
 * live site to finish deploying it. Only a commit that passed every check here
 * (scripts/staging/check-deploy.mjs records that), only forward (a commit
 * already on main and newer than what's live).
 *
 *   node scripts/staging/release.mjs            # the current commit
 *   node scripts/staging/release.mjs <sha>
 *   node scripts/staging/release.mjs <sha> --skip-checks   # emergencies, only when the owner says so
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const skipChecks = args.includes('--skip-checks');
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const sha = git('rev-parse', args.find((a) => !a.startsWith('--')) || 'HEAD');
const short = sha.slice(0, 8);
const railwayEnv = { ...process.env, RAILWAY_CALLER: 'skill:use-railway@1.5.5' };

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (!skipChecks) {
  const record = join(git('rev-parse', '--git-dir'), 'storyvenue-checks', `${sha}.json`);
  const passed = existsSync(record) && JSON.parse(readFileSync(record, 'utf8')).pass === true;
  if (!passed) fail(`${short} hasn't passed the checks here. Run: node scripts/staging/check-deploy.mjs ${short}`);
}

try {
  execFileSync('git', ['fetch', '-q', 'origin', 'main', 'production'], { stdio: 'ignore' });
} catch {
  fail('No production branch yet: run node scripts/staging/setup-gate.mjs once first.');
}
const onMain = () => { try { git('merge-base', '--is-ancestor', sha, 'origin/main'); return true; } catch { return false; } };
const forward = () => { try { git('merge-base', '--is-ancestor', 'origin/production', sha); return true; } catch { return false; } };
if (!onMain()) fail(`${short} isn't on main. Push it to main first (the test copy checks main).`);
if (git('rev-parse', 'origin/production') === sha) fail(`${short} is already live.`);
if (!forward()) fail(`${short} is older than what's live (or not after it). Nothing released.`);

execFileSync('git', ['push', 'origin', `${sha}:refs/heads/production`], { stdio: 'inherit' });
console.log(`production → ${short}${skipChecks ? ' (checks skipped)' : ''}. Waiting for the live site…`);

function liveStatus() {
  const out = execFileSync('railway', ['deployment', 'list', '--service', 'StoryVenue Backend', '--environment', 'production', '--json'], { env: railwayEnv, encoding: 'utf8' });
  const list = JSON.parse(out);
  return (Array.isArray(list) ? list : list.deployments ?? []).find((d) => String(d.meta?.commitHash ?? '').startsWith(short))?.status ?? 'NOT_STARTED';
}
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
