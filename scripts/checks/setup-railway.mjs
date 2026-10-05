#!/usr/bin/env node
/**
 * One time: create the "Checks" service on Railway, in the test copy's
 * environment (Dev) only. It builds Dockerfile.checks from every push to main
 * and runs the full check for that commit (scripts/checks/runner.mjs).
 *
 *   node scripts/checks/setup-railway.mjs            # dry run: say what it would do
 *   node scripts/checks/setup-railway.mjs --apply    # do it
 *
 * What it sets, all in Dev, nothing in production:
 *  1. A service named "Checks", created EMPTY (no source), so that even if
 *     Railway also lists it in production, nothing ever builds or runs there.
 *  2. Its settings, as references to the test copy's own ("StoryVenue
 *     Backend", Dev) so they can never drift or carry a live value:
 *     the names the test suites read, nothing else.
 *  3. For Dev only: this repo as its source, Dockerfile.checks as its build,
 *     no restarts (a crashed run must not loop), sleeping when idle.
 *  4. A trigger: every push to main deploys it, as it does the test copy.
 * Safe to run again: it only fills in what's missing. Values are never read
 * or printed; only names.
 */

import { execFileSync } from 'node:child_process';

const PROJECT = 'e427d556-1a30-449c-8ef1-f9d6236bb7cd';
const BACKEND = 'StoryVenue Backend';
const CHECKS = 'Checks';
const DEV = 'Dev';
const LIVE = 'production';
const apply = process.argv.includes('--apply');
// owner/repo from the git remote, so this keeps working when the repo moves.
const REPO = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim()
  .replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '');
const env = { ...process.env, RAILWAY_CALLER: 'skill:use-railway@1.5.5' };

// The settings the checks read (tests/flows, tests/browser, scripts/staging/smoke.mjs).
const NAMES = [
  'APP_ENV', 'NEXT_PUBLIC_APP_URL', 'STAGING_PASSWORD',
  'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_DB_URL',
  'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'TWOFA_ENABLED',
  'CRON_SECRET', 'MARKETING_CRON_SECRET', 'LEAD_WEBHOOK_SECRET', 'INBOUND_EMAIL_WEBHOOK_TOKEN',
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
];

function railwayApi(query, variables = {}) {
  const out = execFileSync('npx', ['-y', '@railway/cli@5.63.1', 'api', query, '--variables', JSON.stringify(variables)], { env, encoding: 'utf8' });
  const j = JSON.parse(out);
  if (j.errors?.length) throw new Error(j.errors.map((e) => e.message).join('; '));
  return j.data;
}

function layout() {
  const { project } = railwayApi(
    'query p($id: String!) { project(id: $id) { environments { edges { node { id name } } } services { edges { node { id name serviceInstances { edges { node { environmentId source { repo image } } } } } } } } }',
    { id: PROJECT },
  );
  const envId = (name) => project.environments.edges.find((e) => e.node.name === name)?.node.id;
  const service = (name) => project.services.edges.find((s) => s.node.name === name)?.node ?? null;
  return { dev: envId(DEV), live: envId(LIVE), service };
}

const say = (done, text) => console.log(`${done ? 'ok   ' : apply ? 'doing' : 'would'}  ${text}`);

let { dev, live, service } = layout();
if (!dev || !live) throw new Error('Could not find the Dev and production environments.');
const backend = service(BACKEND);
if (!backend) throw new Error(`Could not find ${BACKEND}.`);

// The test copy's own settings: names only, and it must be the test copy.
const backendVars = JSON.parse(execFileSync('railway', ['variables', '--service', BACKEND, '--environment', DEV, '--json'], { env, encoding: 'utf8' }));
if (backendVars.APP_ENV !== 'staging') throw new Error(`${BACKEND} in ${DEV} is not marked as the test copy (APP_ENV). Stopping.`);
if (!/^sk_test_/.test(String(backendVars.STRIPE_SECRET_KEY || 'sk_test_'))) throw new Error('The test copy has a non-test Stripe key. Stopping.');
const names = NAMES.filter((n) => n in backendVars);
const absent = NAMES.filter((n) => !(n in backendVars));

// 1. The service, created empty.
let checks = service(CHECKS);
say(Boolean(checks), `a service named "${CHECKS}", created empty, in ${DEV}`);
if (!checks && apply) {
  railwayApi('mutation c($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }', { input: { projectId: PROJECT, name: CHECKS, environmentId: dev } });
  ({ dev, live, service } = layout());
  checks = service(CHECKS);
  if (!checks) throw new Error('The service was not created.');
}

if (checks) {
  const inDev = checks.serviceInstances.edges.find((i) => i.node.environmentId === dev)?.node ?? null;
  const inLive = checks.serviceInstances.edges.find((i) => i.node.environmentId === live)?.node ?? null;
  if (!inDev) throw new Error(`"${CHECKS}" has no place in ${DEV}. Stopping; nothing else was changed.`);
  if (inLive?.source?.repo || inLive?.source?.image) {
    throw new Error(`"${CHECKS}" has a source in production. It must never run there: remove that in Railway first. Stopping.`);
  }
  console.log(inLive ? `note   Railway also lists "${CHECKS}" in production: empty, no source, nothing runs there.` : `ok     "${CHECKS}" exists in ${DEV} only.`);

  // 2. Its settings: references to the test copy's own.
  const checksVars = JSON.parse(execFileSync('railway', ['variables', '--service', CHECKS, '--environment', DEV, '--json'], { env, encoding: 'utf8' }));
  const want = Object.fromEntries(names.map((n) => [n, `\${{${BACKEND}.${n}}}`]));
  const missing = names.filter((n) => !(n in checksVars));
  say(missing.length === 0, `${names.length} settings pointing at the test copy's own (${missing.length ? `${missing.length} to add` : 'all there'})`);
  if (absent.length) console.log(`note   the test copy doesn't set: ${absent.join(', ')} (left out)`);
  if (missing.length && apply) {
    railwayApi('mutation v($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }',
      { input: { projectId: PROJECT, environmentId: dev, serviceId: checks.id, variables: want, skipDeploys: true } });
  }

  // 3. Dev only: this repo, built from Dockerfile.checks.
  const connected = inDev.source?.repo === REPO;
  say(connected, `${DEV}: source ${REPO}, built from Dockerfile.checks, no restarts, sleeps when idle`);
  if (apply) {
    railwayApi('mutation u($s: String!, $e: String!, $input: ServiceInstanceUpdateInput!) { serviceInstanceUpdate(serviceId: $s, environmentId: $e, input: $input) }', {
      s: checks.id, e: dev,
      // (Naming a Dockerfile is what makes Railway build with it; there is no "Dockerfile" builder to pick.)
      input: { source: { repo: REPO }, dockerfilePath: 'Dockerfile.checks', restartPolicyType: 'NEVER', sleepApplication: true },
    });
  }

  // 4. Every push to main deploys it.
  const { deploymentTriggers } = railwayApi(
    'query t($p: String!, $e: String!, $s: String!) { deploymentTriggers(projectId: $p, environmentId: $e, serviceId: $s) { edges { node { id branch repository } } } }',
    { p: PROJECT, e: dev, s: checks.id },
  );
  const trigger = deploymentTriggers.edges.find((t) => t.node.repository === REPO)?.node ?? null;
  say(trigger?.branch === 'main', `${DEV}: every push to main deploys it${trigger && trigger.branch !== 'main' ? ` (now: ${trigger.branch})` : ''}`);
  if (apply && !trigger) {
    railwayApi('mutation t($input: DeploymentTriggerCreateInput!) { deploymentTriggerCreate(input: $input) { id } }',
      { input: { projectId: PROJECT, environmentId: dev, serviceId: checks.id, provider: 'github', repository: REPO, branch: 'main', checkSuites: false } });
  } else if (apply && trigger.branch !== 'main') {
    railwayApi('mutation u($id: String!) { deploymentTriggerUpdate(id: $id, input: { branch: "main" }) { id } }', { id: trigger.id });
  }

  // Production stays untouched: say so from what Railway reports now.
  if (apply) {
    ({ live, service } = layout());
    const after = service(CHECKS).serviceInstances.edges.find((i) => i.node.environmentId === live)?.node ?? null;
    console.log(after?.source?.repo ? '\nWARNING: Checks has a source in production. Remove it in Railway.' : '\nProduction: untouched (Checks has no source there).');
  }
}

console.log(apply
  ? '\nDone. The next push to main builds the Checks service; or start it now from Railway (Checks → Deploy).'
  : '\nDry run: nothing was changed. Add --apply to do it.');
