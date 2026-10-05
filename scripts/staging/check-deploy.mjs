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
 *   node scripts/staging/check-deploy.mjs <sha> --since <sha>   # "the change" is everything after that commit
 *                                                               # (the trailing check: the commit is already live)
 *
 * A flow-test stage that fails in only a few files gets those files run once
 * more before it counts as failed (a dropped connection from this computer
 * fails a test whatever the code does; a real bug fails twice). The browser
 * tests retry a failed journey once the same way. What needed a second run
 * is printed and recorded, never hidden.
 *
 * The run needs this computer awake for its half hour. It holds off idle
 * sleep itself, but nothing stops a closed lid on battery: a failed run
 * that slept says so and is recorded as such, to be run again.
 *
 * The result is recorded per commit (in .git/storyvenue-checks/), and
 * scripts/staging/release.mjs only puts a commit live that passed here.
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { flowFilesToRerun, laneFor, sleepsDuring, targetedFlowFiles } from './lanes.mjs';

const SERVICE = 'StoryVenue Backend';
const ENV = 'Dev';
/** Where a flow stage leaves vitest's report, inside the checkout. */
const FLOW_REPORT = '.flow-report.json';
const args = process.argv.slice(2);
const sinceAt = args.indexOf('--since');
const since = sinceAt >= 0 ? args[sinceAt + 1] : null;
const sha = args.find((a, i) => !a.startsWith('--') && (sinceAt < 0 || i !== sinceAt + 1))
  || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const startedAt = Date.now();
// Keep this computer from dozing off mid-run (macOS; gone when the run ends).
if (process.platform === 'darwin') {
  try {
    const awake = spawn('caffeinate', ['-ims', '-w', String(process.pid)], { stdio: 'ignore', detached: true });
    awake.on('error', () => { /* no caffeinate: the sleep check below still reports it */ });
    awake.unref();
  } catch { /* same */ }
}
/** How often this computer slept since the run began (macOS power log; 0 when unknown). */
function sleptCount() {
  if (process.platform !== 'darwin') return 0;
  try {
    return sleepsDuring(execFileSync('pmset', ['-g', 'log'], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }), startedAt, Date.now());
  } catch { return 0; }
}
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
// live and this commit; after a hot release the commit IS what's live, so the
// trailing check names the version it replaced with --since). Unknown
// (offline, no production branch) = test everything.
let changed = null;
try {
  if (!since) execFileSync('git', ['fetch', '-q', 'origin', 'production'], { stdio: 'ignore' });
  changed = execFileSync('git', ['diff', '--name-only', since || 'origin/production', sha], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean);
} catch { /* full lane */ }
const lane = laneFor(changed);
if (lane === 'smoke') {
  console.log(`Nothing that ships changed (${changed.length} files, all scripts/tests/docs) — smoke lane.`);
}

const results = [];
/** Stages that only passed on a second run of some files: [{ stage, files }]. */
const reruns = [];
const fullSha = execFileSync('git', ['rev-parse', sha], { encoding: 'utf8' }).trim();

function finish() {
  dropTree();
  console.log('\n── Summary ──');
  for (const [name, ok] of results) {
    const again = reruns.find((r) => r.stage === name);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${again ? `  (needed a second run: ${again.files.join(', ')})` : ''}`);
  }
  const pass = results.every(([, ok]) => ok);
  // A failure on a run this computer slept through says nothing about the code.
  const slept = pass ? 0 : sleptCount();
  const dir = join(execFileSync('git', ['rev-parse', '--git-dir'], { encoding: 'utf8' }).trim(), 'storyvenue-checks');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${fullSha}.json`), JSON.stringify({ sha: fullSha, pass, lane, changed: changed?.length ?? null, slept, reruns, at: new Date().toISOString(), results }, null, 1));
  if (pass) console.log(`\nAll checks passed${lane === 'smoke' ? ' (smoke lane)' : ''}. To put ${short} live: node scripts/staging/release.mjs ${short}`);
  else if (slept) console.log(`\nThis computer went to sleep ${slept} time${slept === 1 ? '' : 's'} during the run, so this failure isn't a verdict on the code. Keep it awake (lid open, or plugged in) and check again.`);
  else console.log('\nNot released: fix the failure, push, and check again.');
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
  // Flow stages also write vitest's report, so a failed stage knows which files failed.
  const flows = (files) => `npx vitest run --config vitest.flows.config.mts --reporter=default --reporter=json --outputFile.json=${FLOW_REPORT} ${files}`.trim();
  if (targeted.length) {
    suites.push([`changed-area flow tests (${targeted.join(', ')})`, flows(targeted.map((f) => `tests/flows/${f}`).join(' ')), 'flows']);
  }
  // A failed browser journey is tried once more by Playwright itself (it reports it as flaky).
  suites.push(['flow tests', flows(''), 'flows'], ['browser tests', 'npx playwright test --reporter=line --retries=1']);
}
const onTestCopy = (cmd) => spawnSync('railway', ['run', '--service', SERVICE, '--environment', ENV, '--', 'sh', '-c', `cd '${tree}' && ${cmd}`], { env: railwayEnv, stdio: 'inherit' });
for (const [name, cmd, kind] of suites) {
  console.log(`\n── ${name} ──`);
  if (kind === 'flows') rmSync(join(tree, FLOW_REPORT), { force: true });
  let r = onTestCopy(cmd);
  if (r.status !== 0 && kind === 'flows') {
    // Only a few files failed: one more run of just those before calling it.
    let again = [];
    // (The report names files by their real path: on a Mac the temp folder is a link.)
    try { again = flowFilesToRerun(JSON.parse(readFileSync(join(tree, FLOW_REPORT), 'utf8')), realpathSync(tree)); } catch { /* no report: the run itself broke */ }
    if (again.length) {
      console.log(`\n── ${name}: a second run of ${again.join(', ')} ──`);
      r = onTestCopy(`npx vitest run --config vitest.flows.config.mts ${again.join(' ')}`);
      if (r.status === 0) {
        reruns.push({ stage: name, files: again });
        console.log(`Passed on the second run. Recorded as needing one: ${again.join(', ')}`);
      }
    }
  }
  results.push([name, r.status === 0]);
  if (r.status !== 0) {
    console.log('\nStopping here — the stages after this one were not run.');
    break;
  }
}
finish();
