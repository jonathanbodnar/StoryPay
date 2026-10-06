#!/usr/bin/env node
/**
 * Clear the test copy of what earlier test runs left behind: the venues they
 * made (and everything under a venue goes with it) and the sign-ins they made.
 * What counts as a leftover is in tidy-rule.mjs: only things named after a run
 * that started more than two hours ago. The seeded venues, the showcase venue
 * and the fixed test accounts carry no run id and are never touched.
 *
 *   railway run --service "StoryVenue Backend" --environment Dev -- node scripts/staging/tidy.mjs          (says what it would remove)
 *   railway run --service "StoryVenue Backend" --environment Dev -- node scripts/staging/tidy.mjs --apply  (removes it)
 *
 * The Checks service runs it with --apply at the start of every run, so the
 * test copy never holds more than a couple of hours of leftovers. It refuses
 * to run anywhere but the test copy.
 */

import pg from 'pg';
import { leftoverUser, leftoverVenue } from './tidy-rule.mjs';

const LIVE_SUPABASE_REF = 'brnxhsaakmhgwcthcapd';
const hide = (s) => String(s).replace(/postgres(ql)?:\/\/\S+/g, '[connection hidden]');
/** The test copy has a handful of venues with a real address (the seeded demo owner). More than this isn't it. */
const MOST_REAL_ADDRESSES = 5;
const AT_A_TIME = 25;

export async function tidyTestCopy({ apply, log = console.log } = {}) {
  const url = (process.env.SUPABASE_DB_URL || '').trim();
  if (process.env.APP_ENV !== 'staging') throw new Error('Run this with railway run --environment Dev (APP_ENV=staging).');
  if (!url || url.includes(LIVE_SUPABASE_REF)) throw new Error('The target must be the test database. Stopping.');

  const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    const now = Date.now();
    const { rows: venues } = await db.query('select id, name, slug, email from public.venues');
    // A second look that this is the test copy: its venues are made-up ones.
    const real = venues.filter((v) => !/@example\.com$/i.test(v.email ?? ''));
    if (real.length > MOST_REAL_ADDRESSES) {
      throw new Error(`${real.length} venues here have real-looking addresses: this is not the test copy. Nothing removed.`);
    }
    const { rows: users } = await db.query('select id, email from auth.users');

    const goVenues = venues.filter((v) => leftoverVenue(v, now));
    const goUsers = users.filter((u) => leftoverUser(u.email, now));
    // Inside the venues that stay (above all the shared Flow Test Venue): the
    // leads, contacts and proposals that earlier runs made there.
    const going = new Set(goVenues.map((v) => v.id));
    const inside = [];
    for (const [table, column] of [['proposals', 'customer_email'], ['leads', 'email'], ['venue_customers', 'customer_email']]) {
      const { rows } = await db.query(`select id, venue_id, ${column} as email from public.${table}`);
      inside.push({ table, total: rows.length, ids: rows.filter((r) => !going.has(r.venue_id) && leftoverUser(r.email, now)).map((r) => r.id) });
    }
    log(`Test copy: ${venues.length} venues, ${goVenues.length} left by earlier runs; ${users.length} sign-ins, ${goUsers.length} left by earlier runs.`);
    log(`In the venues that stay: ${inside.map((x) => `${x.ids.length} of ${x.total} ${x.table.replace('venue_customers', 'contacts')}`).join(', ')} left by earlier runs.`);
    if (!apply) {
      const kept = venues.filter((v) => !goVenues.includes(v));
      log(`Would keep ${kept.length} venues${kept.length <= 12 ? `: ${kept.map((v) => v.name).join(', ')}` : ` (${kept.filter((v) => leftoverVenue(v, now, 0)).length} of them from runs in the last two hours)`}.`);
      log('Nothing removed. Run again with --apply to remove the leftovers.');
      return { venues: goVenues.length, users: goUsers.length, removed: false };
    }

    const started = Date.now();
    for (let i = 0; i < goVenues.length; i += AT_A_TIME) {
      await db.query('delete from public.venues where id = any($1::uuid[])', [goVenues.slice(i, i + AT_A_TIME).map((v) => v.id)]);
    }
    for (let i = 0; i < goUsers.length; i += AT_A_TIME) {
      await db.query('delete from auth.users where id = any($1::uuid[])', [goUsers.slice(i, i + AT_A_TIME).map((u) => u.id)]);
    }
    for (const { table, ids } of inside) {
      for (let i = 0; i < ids.length; i += 200) {
        await db.query(`delete from public.${table} where id = any($1::uuid[])`, [ids.slice(i, i + 200)]);
      }
    }
    const left = (await db.query('select count(*)::int as n from public.venues')).rows[0].n;
    log(`Removed ${goVenues.length} venues, ${goUsers.length} sign-ins and ${inside.map((x) => `${x.ids.length} ${x.table.replace('venue_customers', 'contacts')}`).join(', ')} in ${Math.round((Date.now() - started) / 1000)}s. ${left} venues remain.`);
    return { venues: goVenues.length, users: goUsers.length, removed: true };
  } finally {
    await db.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  tidyTestCopy({ apply: process.argv.includes('--apply') }).catch((e) => {
    console.error(hide(e?.message ?? e));
    process.exit(1);
  });
}
