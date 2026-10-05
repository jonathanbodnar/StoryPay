#!/usr/bin/env node
/**
 * Apply ONE migration to the test copy's database (never the live one):
 * "Database changes: apply to the test copy first."
 *
 *   railway run --service "StoryVenue Backend" --environment Dev -- node scripts/staging/apply-migration.mjs 280
 *
 * The live database gets it from the owner: node scripts/apply-all-migrations.mjs 280 280
 * Runs in one transaction; the connection is never printed.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const LIVE_SUPABASE_REF = 'brnxhsaakmhgwcthcapd';
const number = (process.argv[2] || '').padStart(3, '0');
const url = (process.env.STAGING_SUPABASE_DB_URL || process.env.SUPABASE_DB_URL || '').trim();
if (process.env.APP_ENV !== 'staging' || !url || url.includes(LIVE_SUPABASE_REF)) {
  console.error('Test copy only: railway run --service "StoryVenue Backend" --environment Dev -- node scripts/staging/apply-migration.mjs <number>');
  process.exit(1);
}
const file = readdirSync('migrations').find((f) => f.startsWith(`${number}_`) && f.endsWith('.sql'));
if (!/^\d{3}$/.test(number) || !file) {
  console.error(`No migration numbered ${number}.`);
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
try {
  await client.connect();
  await client.query('begin');
  await client.query(readFileSync(join('migrations', file), 'utf8'));
  await client.query('commit');
  console.log(`Applied to the test copy: ${file}`);
} catch (e) {
  await client.query('rollback').catch(() => {});
  console.error(`Failed, nothing changed: ${String(e.message).replace(/postgres(ql)?:\/\/\S+/g, '[connection hidden]')}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
