#!/usr/bin/env node
/**
 * One time: the live site releases from the `production` branch instead of
 * `main`, so a change goes live only after the test copy passed every check
 * (scripts/staging/check-deploy.mjs, then scripts/staging/release.mjs).
 *
 *   node scripts/staging/setup-gate.mjs
 *
 * 1. Creates `production` at the commit that is live right now (nothing live changes).
 * 2. Points every live service that deploys from this repo at `production`
 *    (StoryVenue Backend, AI Concierge Cron, StoryPay.io Website). The test
 *    copy (Dev) keeps deploying from `main`.
 * Safe to run again: it only fills in what's missing.
 */

import { execFileSync } from 'node:child_process';

const PROJECT = 'e427d556-1a30-449c-8ef1-f9d6236bb7cd';
const PRODUCTION = 'bdd8ebe7-b1e5-402d-868b-fcb15a42bc2e';
// owner/repo from the git remote, so this keeps working when the repo moves.
const REPO = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim()
  .replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '');
const env = { ...process.env, RAILWAY_CALLER: 'skill:use-railway@1.5.5' };

function railwayApi(query, variables) {
  const out = execFileSync('npx', ['-y', '@railway/cli@5.63.1', 'api', query, '--variables', JSON.stringify(variables)], { env, encoding: 'utf8' });
  const j = JSON.parse(out);
  if (j.errors?.length) throw new Error(j.errors.map((e) => e.message).join('; '));
  return j.data;
}

// 1. The `production` branch, at the live commit.
const remote = execFileSync('git', ['ls-remote', 'origin', 'refs/heads/production'], { encoding: 'utf8' }).trim();
if (remote) {
  console.log(`production branch exists at ${remote.slice(0, 8)}`);
} else {
  const list = JSON.parse(execFileSync('railway', ['deployment', 'list', '--service', 'StoryVenue Backend', '--environment', 'production', '--json'], { env, encoding: 'utf8' }));
  const live = (Array.isArray(list) ? list : list.deployments ?? []).find((d) => d.status === 'SUCCESS')?.meta?.commitHash;
  if (!live) throw new Error('Could not find the live commit.');
  execFileSync('git', ['fetch', '-q', 'origin', 'main']);
  execFileSync('git', ['push', 'origin', `${live}:refs/heads/production`], { stdio: 'inherit' });
  console.log(`created production at the live commit ${live.slice(0, 8)}`);
}

// 2. Live services deploying from this repo's main → production.
const { project } = railwayApi('query p($id: String!) { project(id: $id) { services { edges { node { id name } } } } }', { id: PROJECT });
for (const { node: svc } of project.services.edges) {
  const { deploymentTriggers } = railwayApi(
    'query t($p: String!, $e: String!, $s: String!) { deploymentTriggers(projectId: $p, environmentId: $e, serviceId: $s) { edges { node { id branch repository } } } }',
    { p: PROJECT, e: PRODUCTION, s: svc.id },
  );
  for (const { node: trig } of deploymentTriggers.edges) {
    if (trig.repository !== REPO) continue;
    if (trig.branch === 'production') {
      console.log(`${svc.name}: already releases from production`);
      continue;
    }
    const { deploymentTriggerUpdate } = railwayApi(
      'mutation u($id: String!) { deploymentTriggerUpdate(id: $id, input: { branch: "production" }) { id branch } }',
      { id: trig.id },
    );
    console.log(`${svc.name}: ${trig.branch} → ${deploymentTriggerUpdate.branch}`);
  }
}
console.log('\nDone. Pushes to main now update only the test copy; release.mjs puts a checked commit live.');
