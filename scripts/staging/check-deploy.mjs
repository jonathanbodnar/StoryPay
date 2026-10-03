#!/usr/bin/env node
/**
 * After a push: run the code checks on this exact commit (type check, fast
 * checks, lint), wait for the test copy to finish deploying it, then run every
 * check against the test copy: the smoke test, the flow tests and the browser
 * tests. Exits non-zero when anything fails.
 *
 *   node scripts/staging/check-deploy.mjs           # the current commit
 *   node scripts/staging/check-deploy.mjs <sha>
 *
 * The result is recorded per commit (in .git/storyvenue-checks/), and
 * scripts/staging/release.mjs only puts a commit live that passed here.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
const results = [];
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
const dropTree = () => {
  try { execFileSync('git', ['worktree', 'remove', '--force', tree], { stdio: 'ignore' }); } catch { /* already gone */ }
};

// 1. Wait for the test copy to run this commit.
const until = Date.now() + 15 * 60_000;
let status = deploymentStatus();
process.stdout.write(`Test copy deploy of ${short}: ${status}`);
while (!['SUCCESS', 'FAILED', 'CRASHED', 'REMOVED'].includes(status)) {
  if (Date.now() > until) {
    console.log('\nGave up waiting after 15 minutes.');
    dropTree();
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 20_000));
  status = deploymentStatus();
  process.stdout.write(` → ${status}`);
}
console.log('');
if (status !== 'SUCCESS') {
  console.log(status === 'REMOVED' ? 'A newer push replaced this deploy; check that one instead.' : 'The test copy failed to deploy this commit.');
  dropTree();
  process.exit(1);
}

// 2. Every check, against the test copy, from the clean checkout. (railway
//    run starts here, where the project is linked; the tests run in the tree.)
const suites = [
  ['smoke test', 'node scripts/staging/smoke.mjs'],
  ['flow tests', 'npm run test:flows'],
  ['browser tests', 'npx playwright test --reporter=line'],
];
for (const [name, cmd] of suites) {
  console.log(`\n── ${name} ──`);
  const r = spawnSync('railway', ['run', '--service', SERVICE, '--environment', ENV, '--', 'sh', '-c', `cd '${tree}' && ${cmd}`], { env: railwayEnv, stdio: 'inherit' });
  results.push([name, r.status === 0]);
}
dropTree();

console.log('\n── Summary ──');
for (const [name, ok] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
const pass = results.every(([, ok]) => ok);
const fullSha = execFileSync('git', ['rev-parse', sha], { encoding: 'utf8' }).trim();
const dir = join(execFileSync('git', ['rev-parse', '--git-dir'], { encoding: 'utf8' }).trim(), 'storyvenue-checks');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, `${fullSha}.json`), JSON.stringify({ sha: fullSha, pass, at: new Date().toISOString(), results }, null, 1));
console.log(pass ? `\nAll checks passed. To put ${short} live: node scripts/staging/release.mjs ${short}` : '\nNot released: fix the failures, push, and check again.');
process.exit(pass ? 0 : 1);
