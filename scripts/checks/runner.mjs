#!/usr/bin/env node
/**
 * The checks runner: Railway service "Checks", in the test copy's
 * environment. Railway builds it (Dockerfile.checks) from every push to
 * main, and it then runs the full check for THAT commit against the test
 * copy and writes down the verdict. Nothing about a release depends on a
 * laptop staying awake and online any more (Oct 5 2026: four of seven full
 * runs had failed from the laptop they ran on, none from the code).
 *
 * What it runs is what scripts/staging/check-deploy.mjs ran from the laptop:
 *
 *   1. Code checks (type check, fast checks, lint, security advisories),
 *      while the test copy is still deploying this commit.
 *   2. Smoke test, once the test copy serves this commit.
 *   3. The changed area's flow tests first, so a broken change fails early.
 *   4. Every flow test and the browser tests, side by side.
 *
 * "The change" is everything since the last commit that passed here, so a
 * newer push simply replaces a run in progress (Railway stops the old
 * container) and answers for both. A flow stage that fails in a few files
 * reruns just those once (scripts/staging/lanes.mjs); the browser tests retry
 * a failed journey once. Whatever needed a second run is recorded.
 *
 * The verdict lives in the test copy's database (admin_kv_cache,
 * "checks:<sha>"); scripts/staging/check-deploy.mjs reads it from there.
 * This only ever runs on the test copy: it refuses anything else.
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { flowFilesToRerun, laneFor, targetedFlowFiles } from '../staging/lanes.mjs';
import { CHECKS_CURRENT, CHECKS_LAST_GREEN, checksKey, summarize } from './verdict-shape.mjs';

const e = process.env;
const LIVE_SUPABASE_REF = 'brnxhsaakmhgwcthcapd';
const sha = (e.RAILWAY_GIT_COMMIT_SHA || process.argv[2] || '').trim();
const short = sha.slice(0, 8);
const appUrl = (e.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '');
const repo = e.RAILWAY_GIT_REPO_OWNER && e.RAILWAY_GIT_REPO_NAME
  ? `${e.RAILWAY_GIT_REPO_OWNER}/${e.RAILWAY_GIT_REPO_NAME}`
  : (e.CHECKS_REPO || 'jonathanbodnar/StoryPay');
const root = realpathSync(process.cwd());
const FLOW_REPORT = '.flow-report.json';

// Railway expects a service to answer; this says what the run is doing.
const state = { sha, status: 'starting', stage: 'starting' };
createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ sha: state.sha, status: state.status, stage: state.stage }));
}).listen(Number(e.PORT) || 3000);

function refuse(why) {
  console.error(`Checks runner: ${why} Doing nothing.`);
  state.status = 'refused';
  state.stage = why;
  // Stay up, idle: exiting would only make Railway start it again.
  setInterval(() => {}, 1 << 30);
}

const db = () => createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const record = { sha, startedAt: new Date().toISOString(), status: 'running', stage: 'starting', lane: null, base: null, changed: null, results: [], reruns: [], failure: null };

/** Write the run's record where the release scripts read it. */
async function save(patch = {}) {
  Object.assign(record, patch);
  state.status = record.status;
  state.stage = record.stage;
  const { error } = await db().from('admin_kv_cache')
    .upsert({ key: checksKey(sha), value: record, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) console.error('could not save the record:', error.message);
}

/** Run one command, streaming its output; resolves { ok, tail } (tail: its last lines, for the record). */
function sh(command, label) {
  return new Promise((resolve) => {
    const tail = [];
    const child = spawn('sh', ['-c', command], { cwd: root, env: { ...e, FORCE_COLOR: '0' } });
    const take = (chunk) => {
      for (const line of String(chunk).split('\n')) {
        if (!line.trim()) continue;
        console.log(label ? `[${label}] ${line}` : line);
        tail.push(line);
        if (tail.length > 80) tail.shift();
      }
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('close', (code) => resolve({ ok: code === 0, tail: tail.join('\n') }));
    child.on('error', (err) => resolve({ ok: false, tail: String(err) }));
  });
}

async function stage(name, work) {
  console.log(`\n── ${name} ──`);
  await save({ stage: name });
  const started = Date.now();
  const r = await work();
  record.results.push([name, r.ok, Math.round((Date.now() - started) / 1000)]);
  if (!r.ok && !record.failure) record.failure = { stage: name, tail: String(r.tail || '').slice(-6000) };
  await save();
  return r.ok;
}

async function github(path) {
  const res = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'storyvenue-checks', ...(e.GITHUB_TOKEN ? { authorization: `Bearer ${e.GITHUB_TOKEN}` } : {}) },
  });
  if (!res.ok) throw new Error(`GitHub ${path}: ${res.status}`);
  return res.json();
}

/** Everything since the last commit that passed here (or, the first time, since what's live). null = unknown: test everything. */
async function whatChanged() {
  let base = null;
  try {
    const { data } = await db().from('admin_kv_cache').select('value').eq('key', CHECKS_LAST_GREEN).maybeSingle();
    base = data?.value?.sha ?? null;
  } catch { /* first run */ }
  try {
    if (!base) base = (await github('branches/production')).commit.sha;
    if (base === sha) return { base, changed: [] };
    const cmp = await github(`compare/${base}...${sha}`);
    // GitHub lists at most 300 files; more than that is "everything".
    const files = Array.isArray(cmp.files) ? cmp.files.map((f) => f.filename) : null;
    return { base, changed: files && files.length < 300 ? files : null };
  } catch (err) {
    console.log(`Could not work out what changed (${err.message}): testing everything.`);
    return { base, changed: null };
  }
}

/** The test copy has to be serving this very commit before anything is tested against it. */
async function waitForTestCopy() {
  const until = Date.now() + 25 * 60_000;
  let seen = '';
  for (;;) {
    try {
      const res = await fetch(`${appUrl}/api/staging/version`, { headers: { 'x-staging-key': e.STAGING_PASSWORD || '' } });
      const now = res.ok ? String((await res.json()).sha || '') : `HTTP ${res.status}`;
      if (now === sha) return { ok: true, tail: '' };
      if (now !== seen) console.log(`[test copy] serving ${now.slice(0, 8) || 'nothing yet'}; waiting for ${short}`);
      seen = now;
    } catch (err) {
      if (String(err) !== seen) console.log(`[test copy] not answering yet (${err.message})`);
      seen = String(err);
    }
    if (Date.now() > until) return { ok: false, tail: `The test copy never served ${short} (last seen: ${seen.slice(0, 60)}).` };
    await new Promise((r) => setTimeout(r, 10_000));
  }
}

/** A flow stage: on a failure in only a few files, those files once more. */
async function flowStage(name, files, label) {
  const report = `${FLOW_REPORT}.${label}`;
  const vitest = (list, extra = '') => `npx vitest run --config vitest.flows.config.mts ${extra} ${list}`.replace(/\s+/g, ' ').trim();
  return stage(name, async () => {
    rmSync(join(root, report), { force: true });
    let r = await sh(vitest(files, `--reporter=default --reporter=json --outputFile.json=${report}`), label);
    if (!r.ok) {
      let again = [];
      try { again = flowFilesToRerun(JSON.parse(readFileSync(join(root, report), 'utf8')), root); } catch { /* no report: the run itself broke */ }
      if (again.length) {
        console.log(`\n── ${name}: a second run of ${again.join(', ')} ──`);
        const second = await sh(vitest(again.join(' ')), `${label} again`);
        if (second.ok) {
          record.reruns.push({ stage: name, files: again });
          console.log(`Passed on the second run. Recorded as needing one: ${again.join(', ')}`);
          r = second;
        }
      }
    }
    return r;
  });
}

async function run() {
  console.log(`Checks for ${short} against ${appUrl}`);
  // This is now the run: an older one still waiting on its verdict is told it was replaced.
  await db().from('admin_kv_cache').upsert({ key: CHECKS_CURRENT, value: { sha, at: record.startedAt }, updated_at: record.startedAt }, { onConflict: 'key' });
  const { base, changed } = await whatChanged();
  const lane = laneFor(changed);
  await save({ base, changed: changed?.length ?? null, lane });
  console.log(`Since ${String(base).slice(0, 8)}: ${changed ? `${changed.length} files changed` : 'unknown'} → ${lane === 'smoke' ? 'smoke lane (nothing that ships changed)' : 'the full check'}`);

  // 1. Code checks, while the test copy is still deploying this commit.
  const deployed = waitForTestCopy();
  let ok = true;
  for (const [name, cmd] of [
    ['type check', 'npx tsc --noEmit'],
    ['fast checks', 'npx vitest run'],
    ['lint', 'npx eslint .'],
    ['security advisories', 'npm audit --omit=dev --audit-level=moderate'],
  ]) {
    ok = (await stage(name, () => sh(cmd, name))) && ok;
  }

  // 2. The test copy serves this commit; does it stand up?
  if (ok) ok = await stage('test copy deploy', () => deployed);
  if (ok) ok = await stage('smoke test', () => sh('node scripts/staging/smoke.mjs', 'smoke'));

  if (ok && lane === 'full') {
    // 3. The changed area's flow tests first.
    const flowDir = join(root, 'tests', 'flows');
    const flowTests = readdirSync(flowDir).filter((f) => f.endsWith('.test.ts')).map((name) => ({ name, source: readFileSync(join(flowDir, name), 'utf8') }));
    const targeted = targetedFlowFiles(changed, flowTests);
    if (targeted.length) {
      ok = await flowStage(`changed-area flow tests (${targeted.join(', ')})`, targeted.map((f) => `tests/flows/${f}`).join(' '), 'changed');
    }
    // 4. Every flow test and the browser tests, side by side: they are two
    //    different kinds of visitor to the same test copy. A failed browser
    //    journey is tried once more by Playwright itself (it calls it flaky).
    if (ok) {
      const [flows, browser] = await Promise.all([
        flowStage('flow tests', '', 'flows'),
        stage('browser tests', () => sh('npx playwright test --reporter=line --retries=1', 'browser')),
      ]);
      ok = flows && browser;
    }
  }

  const pass = record.results.every(([, good]) => good);
  await save({ status: pass ? 'pass' : 'fail', stage: 'finished', finishedAt: new Date().toISOString() });
  if (pass) {
    const { error } = await db().from('admin_kv_cache')
      .upsert({ key: CHECKS_LAST_GREEN, value: { sha, at: record.finishedAt }, updated_at: record.finishedAt }, { onConflict: 'key' });
    if (error) console.error('could not record the last passing commit:', error.message);
  }
  console.log(`\n── Summary ──\n${summarize(record)}`);
  // Stay up, idle, until the next push replaces this container.
  setInterval(() => {}, 1 << 30);
}

// Last, so everything above exists before the run starts.
if (e.APP_ENV !== 'staging' || !appUrl || /storyvenue\.com|storypay\.io/.test(appUrl)
  || !e.NEXT_PUBLIC_SUPABASE_URL || e.NEXT_PUBLIC_SUPABASE_URL.includes(LIVE_SUPABASE_REF) || !e.SUPABASE_SERVICE_ROLE_KEY) {
  refuse('this is not the test copy (or its settings are missing).');
} else if (!/^[0-9a-f]{40}$/.test(sha)) {
  refuse('no commit to check (RAILWAY_GIT_COMMIT_SHA is missing).');
} else {
  run().catch(async (err) => {
    console.error('Checks runner crashed:', err);
    await save({ status: 'fail', stage: 'the runner itself', error: String(err?.message || err).slice(0, 500), finishedAt: new Date().toISOString() }).catch(() => {});
  });
}
