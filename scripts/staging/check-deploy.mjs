#!/usr/bin/env node
/**
 * After a push: run the code checks on this exact commit (type check, fast
 * checks, lint, security advisories), wait for the test copy to finish
 * deploying it, then run the checks against the test copy. Built to fail
 * fast and pass thoroughly:
 *
 *  - a failed code check stops everything before the test copy;
 *  - the changed area's flow tests run FIRST, so a broken change dies in
 *    the first minutes instead of after the whole suite;
 *  - then the full run: smoke, every flow test, the browser tests — and the
 *    first failing stage stops the rest (fix, push, check again);
 *  - a commit that ships nothing (only scripts/, tests/, docs/, *.md
 *    against what's live) runs the smoke lane: code checks + smoke test.
 *
 *   node scripts/staging/check-deploy.mjs           # the current commit
 *   node scripts/staging/check-deploy.mjs <sha>
 *
 * The result is recorded per commit (in .git/storyvenue-checks/), and
 * scripts/staging/release.mjs only puts a commit live that passed here.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { laneFor, targetedFlowFiles } from './lanes.mjs';

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

// 0. A clean checkout of this commit: every check runs from it, never from the
//    working tree (which may already hold the next change).
const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const tree = join(tmpdir(), `storyvenue-check-${short}`);
rmSync(tree, { recursive: true, force: true });
execFileSync('git', ['worktree', 'prune']);
execFileSync('git', ['worktree', 'add', '--detach', '--force', tree, sha], { stdio: 'ignore' });
symlinkSync(join(repo, 'node_modules'), join(tree, 'node_modules'));
const dropTree = () => {
  try { execFileSync('git', ['worktree', 'remove', '--force', tree], { stdio: 'ignore' }); } catch { /* already gone */ }
};

// What this release would change on the live site (everything between what's
// live and this commit). Unknown (offline, no production branch) = test everything.
let changed = null;
try {
  execFileSync('git', ['fetch', '-q', 'origin', 'production'], { stdio: 'ignore' });
  changed = execFileSync('git', ['diff', '--name-only', 'origin/production', sha], { encoding: 'utf8' }).split('\n').filter(Boolean);
} catch { /* full lane */ }
const lane = laneFor(changed);
if (lane === 'smoke') {
  console.log(`Nothing that ships changed (${changed.length} files, all scripts/tests/docs) — smoke lane.`);
}

const results = [];
const fullSha = execFileSync('git', ['rev-parse', sha], { encoding: 'utf8' }).trim();

function finish() {
  dropTree();
  console.log('\n── Summary ──');
  for (const [name, ok] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  const pass = results.every(([, ok]) => ok);
  const dir = join(execFileSync('git', ['rev-parse', '--git-dir'], { encoding: 'utf8' }).trim(), 'storyvenue-checks');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${fullSha}.json`), JSON.stringify({ sha: fullSha, pass, lane, changed: changed?.length ?? null, at: new Date().toISOString(), results }, null, 1));
  console.log(pass
    ? `\nAll checks passed${lane === 'smoke' ? ' (smoke lane)' : ''}. To put ${short} live: node scripts/staging/release.mjs ${short}`
    : '\nNot released: fix the failure, push, and check again.');
  process.exit(pass ? 0 : 1);
}

// 1. Code checks, from the clean checkout. A failure stops everything here —
//    no point waiting on a deploy for code that doesn't pass its own checks.
for (const [name, cmd] of [
  ['type check', ['npx', 'tsc', '--noEmit']],
  ['fast checks', ['npx', 'vitest', 'run']],
  ['lint', ['npx', 'eslint', '.']],
  // A package we ship with a known security problem (moderate or worse) stops the release.
  ['security advisories', ['npm', 'audit', '--omit=dev', '--audit-level=moderate']],
]) {
  console.log(`\n── ${name} ──`);
  const r = spawnSync(cmd[0], cmd.slice(1), { cwd: tree, stdio: 'inherit' });
  results.push([name, r.status === 0]);
}
if (results.some(([, ok]) => !ok)) finish();

// 2. Wait for the test copy to run this commit.
const until = Date.now() + 15 * 60_000;
let status = deploymentStatus();
process.stdout.write(`Test copy deploy of ${short}: ${status}`);
while (!['SUCCESS', 'FAILED', 'CRASHED', 'REMOVED'].includes(status)) {
  if (Date.now() > until) {
    console.log('\nGave up waiting after 15 minutes.');
    results.push(['test copy deploy', false]);
    finish();
  }
  await new Promise((r) => setTimeout(r, 20_000));
  status = deploymentStatus();
  process.stdout.write(` → ${status}`);
}
console.log('');
if (status !== 'SUCCESS') {
  console.log(status === 'REMOVED' ? 'A newer push replaced this deploy; check that one instead.' : 'The test copy failed to deploy this commit.');
  results.push(['test copy deploy', false]);
  finish();
}

// 3. Against the test copy, from the clean checkout, stopping at the first
//    failing stage. (railway run starts here, where the project is linked;
//    the tests run in the tree.)
const suites = [['smoke test', 'node scripts/staging/smoke.mjs']];
if (lane === 'full') {
  const flowDir = join(tree, 'tests', 'flows');
  const flowTests = readdirSync(flowDir).filter((f) => f.endsWith('.test.ts')).map((name) => ({ name, source: readFileSync(join(flowDir, name), 'utf8') }));
  const targeted = targetedFlowFiles(changed, flowTests);
  if (targeted.length) {
    suites.push([`changed-area flow tests (${targeted.join(', ')})`,
      `npx vitest run --config vitest.flows.config.mts ${targeted.map((f) => `tests/flows/${f}`).join(' ')}`]);
  }
  suites.push(['flow tests', 'npm run test:flows'], ['browser tests', 'npx playwright test --reporter=line']);
}
for (const [name, cmd] of suites) {
  console.log(`\n── ${name} ──`);
  const r = spawnSync('railway', ['run', '--service', SERVICE, '--environment', ENV, '--', 'sh', '-c', `cd '${tree}' && ${cmd}`], { env: railwayEnv, stdio: 'inherit' });
  results.push([name, r.status === 0]);
  if (r.status !== 0) {
    console.log('\nStopping here — the stages after this one were not run.');
    break;
  }
}
finish();
