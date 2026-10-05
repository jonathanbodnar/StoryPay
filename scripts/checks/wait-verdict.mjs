#!/usr/bin/env node
/**
 * Wait for the Checks service's verdict on a commit and print it as it goes.
 * Run with the test copy's settings (check-deploy.mjs does this):
 *
 *   railway run --service "StoryVenue Backend" --environment Dev -- node scripts/checks/wait-verdict.mjs <full sha> [--out file] [--after ISO]
 *
 * Exit: 0 passed, 1 failed, 3 no usable run (none appeared, or it went
 * silent): the caller then runs the checks itself. 4 replaced: a newer push
 * took over the Checks service, and its run answers for this commit too. --after only accepts a
 * run started after that moment (a fresh run of a commit checked before).
 *
 * Only reads. A dropped connection here costs nothing: it asks again.
 */

import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { CHECKS_CURRENT, checksKey, replacedBy, summarize, verdictOf } from './verdict-shape.mjs';

const e = process.env;
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const sha = args.find((a) => /^[0-9a-f]{40}$/.test(a));
if (e.APP_ENV !== 'staging' || !e.NEXT_PUBLIC_SUPABASE_URL || !e.SUPABASE_SERVICE_ROLE_KEY || !sha) {
  console.error('Usage (with the test copy’s settings): node scripts/checks/wait-verdict.mjs <full sha>');
  process.exit(3);
}
const after = opt('--after') ? Date.parse(opt('--after')) : 0;
const out = opt('--out');
const db = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const short = sha.slice(0, 8);

/** How long to wait for a run to appear at all: Railway has to build the runner first. */
const APPEAR_WITHIN_MS = 15 * 60_000;
const GIVE_UP_AFTER_MS = 75 * 60_000;
const began = Date.now();
let printed = 0;
let lastStage = '';
let unreachable = 0;
let askedIfSetUp = false;

for (;;) {
  let row = null;
  try {
    const { data, error } = await db.from('admin_kv_cache').select('value, updated_at').eq('key', checksKey(sha)).maybeSingle();
    if (error) throw new Error(error.message);
    row = data;
    unreachable = 0;
  } catch (err) {
    unreachable += 1;
    if (unreachable === 1 || unreachable % 8 === 0) console.log(`(couldn’t reach the test copy’s database just now: ${String(err.message).slice(0, 80)}; asking again)`);
  }
  // Before the Checks service has ever run, there is nothing to wait for.
  if (!row && !unreachable && !askedIfSetUp) {
    askedIfSetUp = true;
    const any = await db.from('admin_kv_cache').select('key').like('key', 'checks:%').limit(1);
    if (!any.error && !(any.data ?? []).length) {
      console.log('The Checks service has never reported: it isn’t set up yet.');
      process.exit(3);
    }
  }
  const record = row?.value;
  const fresh = record && (!after || Date.parse(record.startedAt ?? '') >= after);
  const verdict = fresh ? verdictOf(row) : 'missing';

  if (fresh) {
    if (!printed && !lastStage) console.log(`Checks service: ${short}, everything since ${String(record.base ?? 'unknown').slice(0, 8)} (${record.changed ?? 'unknown'} files), ${record.lane === 'smoke' ? 'smoke lane' : 'the full check'}`);
    for (const [name, ok, seconds] of (record.results ?? []).slice(printed)) {
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${typeof seconds === 'number' ? `  (${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s)` : ''}`);
    }
    printed = (record.results ?? []).length;
    if (verdict === 'running' && record.stage && record.stage !== lastStage) console.log(`…  ${record.stage}`);
    lastStage = record.stage ?? lastStage;
  }

  if (verdict === 'pass' || verdict === 'fail') {
    if (out) writeFileSync(out, JSON.stringify(record));
    console.log(`\n── Summary (Checks service) ──\n${summarize(record)}`);
    if (verdict === 'fail' && record.failure) console.log(`\n── What failed: ${record.failure.stage} ──\n${record.failure.tail}`);
    if (record.error) console.log(`\nThe runner itself broke: ${record.error}`);
    process.exit(verdict === 'pass' ? 0 : 1);
  }
  if (verdict !== 'pass' && verdict !== 'fail' && !unreachable) {
    const current = await db.from('admin_kv_cache').select('value').eq('key', CHECKS_CURRENT).maybeSingle();
    const newer = current.error ? null : replacedBy(fresh ? row : null, current.data, sha);
    // (A run asked for again keeps waiting for its own fresh record.)
    if (newer && !after) {
      console.log(`A newer push (${newer.slice(0, 8)}) replaced the run of ${short}. Its check covers this commit too: wait on that one.`);
      process.exit(4);
    }
  }
  if (verdict === 'stalled') {
    console.log(`The Checks service’s run of ${short} went silent (replaced by a newer push, or it died).`);
    process.exit(3);
  }
  if (verdict === 'missing' && Date.now() - began > APPEAR_WITHIN_MS) {
    console.log(`The Checks service has no run of ${short} after ${Math.round(APPEAR_WITHIN_MS / 60_000)} minutes.`);
    process.exit(3);
  }
  if (Date.now() - began > GIVE_UP_AFTER_MS) {
    console.log(`Still no verdict on ${short} after ${Math.round(GIVE_UP_AFTER_MS / 60_000)} minutes.`);
    process.exit(3);
  }
  await new Promise((r) => setTimeout(r, 15_000));
}
