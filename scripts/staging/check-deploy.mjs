#!/usr/bin/env node
/**
 * After a push: wait for the test copy to finish deploying this commit, then
 * run every check against it: the smoke test, the flow tests and the browser
 * tests. Exits non-zero when anything fails.
 *
 *   node scripts/staging/check-deploy.mjs           # the current commit
 *   node scripts/staging/check-deploy.mjs <sha>
 *
 * Report-only for now: production still deploys from main.
 */

import { execFileSync, spawnSync } from 'node:child_process';

const SERVICE = 'StoryVenue Backend';
const ENV = 'Dev';
const sha = process.argv[2] || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const railwayEnv = { ...process.env, RAILWAY_CALLER: 'skill:use-railway@1.5.5' };
const short = sha.slice(0, 8);

function deploymentStatus() {
  const out = execFileSync('railway', ['deployment', 'list', '--service', SERVICE, '--environment', ENV, '--json'], { env: railwayEnv, encoding: 'utf8' });
  const list = JSON.parse(out);
  const all = Array.isArray(list) ? list : list.deployments ?? [];
  return all.find((d) => String(d.meta?.commitHash ?? '').startsWith(short))?.status ?? 'NOT_STARTED';
}

// 1. Wait for the test copy to run this commit.
const until = Date.now() + 15 * 60_000;
let status = deploymentStatus();
process.stdout.write(`Test copy deploy of ${short}: ${status}`);
while (!['SUCCESS', 'FAILED', 'CRASHED', 'REMOVED'].includes(status)) {
  if (Date.now() > until) {
    console.log('\nGave up waiting after 15 minutes.');
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 20_000));
  status = deploymentStatus();
  process.stdout.write(` → ${status}`);
}
console.log('');
if (status !== 'SUCCESS') {
  console.log(status === 'REMOVED' ? 'A newer push replaced this deploy; check that one instead.' : 'The test copy failed to deploy this commit.');
  process.exit(1);
}

// 2. Every check, against the test copy.
const suites = [
  ['smoke test', ['node', 'scripts/staging/smoke.mjs']],
  ['flow tests', ['npm', 'run', 'test:flows']],
  ['browser tests', ['npx', 'playwright', 'test', '--reporter=line']],
];
const results = [];
for (const [name, cmd] of suites) {
  console.log(`\n── ${name} ──`);
  const r = spawnSync('railway', ['run', '--service', SERVICE, '--environment', ENV, '--', ...cmd], { env: railwayEnv, stdio: 'inherit' });
  results.push([name, r.status === 0]);
}

console.log('\n── Summary ──');
for (const [name, ok] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
process.exit(results.every(([, ok]) => ok) ? 0 : 1);
