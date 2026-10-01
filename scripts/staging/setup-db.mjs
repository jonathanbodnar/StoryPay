#!/usr/bin/env node
/**
 * Build the test copy's database from the live one's STRUCTURE: tables,
 * security rules (RLS), functions, triggers, indexes and permissions. No rows
 * are ever copied. Then creates the same storage buckets.
 *
 * The live structure is read with SUPABASE_DB_URL from .env.local (pg_dump
 * --schema-only). The test database comes from the Dev environment:
 *   railway run --service "StoryVenue Backend" --environment Dev -- node scripts/staging/setup-db.mjs
 *
 * Refuses the live database as a target, and a target that already has
 * tables unless --force. Applies everything in one transaction, so a failure
 * leaves the test database as it was. Connection details go to the Postgres
 * tools through environment variables and are never printed.
 * Needs the Postgres 17+ client tools (brew install libpq).
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';

const LIVE_SUPABASE_REF = 'brnxhsaakmhgwcthcapd';
const BIN = '/opt/homebrew/opt/libpq/bin';
const force = process.argv.includes('--force');
const hide = (s) => String(s).replace(/postgres(ql)?:\/\/\S+/g, '[connection hidden]');

/** libpq settings for a connection URL, so the URL never appears in a command line. */
function pgEnv(url) {
  const u = new URL(url);
  return {
    ...process.env,
    PGHOST: u.hostname,
    PGPORT: u.port || '5432',
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: u.pathname.slice(1) || 'postgres',
    PGSSLMODE: 'require',
  };
}

function run(bin, args, url) {
  const r = spawnSync(join(BIN, bin), args, { env: pgEnv(url), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${bin} failed (exit ${r.status}):\n${hide(r.stderr || r.error?.message || '').trim().slice(-3000)}`);
}

async function main() {
  const liveUrl = (readFileSync('.env.local', 'utf8').match(/^SUPABASE_DB_URL\s*=\s*(.+)$/m) || [])[1]?.trim().replace(/^"|"$/g, '');
  const testUrl = (process.env.STAGING_SUPABASE_DB_URL || process.env.SUPABASE_DB_URL || '').trim();
  const testApi = (process.env.STAGING_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const testKey = (process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!liveUrl?.includes(LIVE_SUPABASE_REF)) throw new Error('.env.local SUPABASE_DB_URL is not the live database');
  for (const [name, v] of [['test database URL', testUrl], ['test API URL', testApi], ['test service key', testKey]]) {
    if (!v) throw new Error(`Missing the ${name}: run this with railway run --environment Dev`);
  }
  if (testUrl.includes(LIVE_SUPABASE_REF) || testApi.includes(LIVE_SUPABASE_REF)) throw new Error('The target is the live database. Stopping.');

  const connect = async (url) => {
    const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
    await c.connect();
    return c;
  };
  const counts = async (c) => (await c.query(`
    select (select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE')::int as tables,
           (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public')::int as functions,
           (select count(*) from pg_policies where schemaname = 'public')::int as policies,
           (select count(*) from pg_indexes where schemaname = 'public')::int as indexes,
           (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and not t.tgisinternal)::int as triggers`)).rows[0];

  const test = await connect(testUrl);
  const before = await counts(test);
  if (before.tables > 0 && !force) {
    console.error(`The test database already has ${before.tables} tables. Rerun with --force to apply the structure on top.`);
    process.exit(1);
  }

  // 1. Structure only, from the live database (read-only).
  const dir = mkdtempSync(join(tmpdir(), 'sv-staging-'));
  const dump = join(dir, 'schema.sql');
  try {
    run('pg_dump', ['--schema-only', '--schema=public', '--no-owner', `--file=${dump}`], liveUrl);
    let sql = readFileSync(dump, 'utf8');
    if (/^(COPY|INSERT INTO) /m.test(sql)) throw new Error('The dump contains rows. Stopping.');
    // A new Supabase project already has the public schema, its comment and
    // supabase_admin's default privileges (which our login may not change);
    // "Enable automatic RLS" already made public.rls_auto_enable().
    sql = sql
      .replace(/^CREATE SCHEMA public;$/m, '')
      .replace(/^COMMENT ON SCHEMA public IS .*;$/m, '')
      .replace(/^ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin .*;$/gm, '')
      .replace(/^CREATE FUNCTION /gm, 'CREATE OR REPLACE FUNCTION ');
    writeFileSync(dump, sql);

    // 2. What the structure needs first: the vector extension and the read-only agent role.
    await test.query('create extension if not exists vector with schema extensions');
    await test.query(`do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'mcp_readonly') then create role mcp_readonly nologin; end if;
    end $$`);
    await test.end();

    // 3. Apply it in one transaction, stopping at the first error.
    run('psql', ['-v', 'ON_ERROR_STOP=1', '--single-transaction', '--quiet', '-f', dump], testUrl);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // 4. The same storage buckets (via the Storage API: Supabase guards the table).
  const live = await connect(liveUrl);
  const buckets = (await live.query('select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id')).rows;
  const liveCounts = await counts(live);
  await live.end();
  for (const b of buckets) {
    const res = await fetch(`${testApi}/storage/v1/bucket`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${testKey}`, apikey: testKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: b.id, name: b.id, public: b.public, file_size_limit: b.file_size_limit ? Number(b.file_size_limit) : null, allowed_mime_types: b.allowed_mime_types }),
    });
    const text = res.ok ? '' : await res.text();
    console.log(`bucket ${b.id}: ${res.ok || /already exists/i.test(text) ? 'ready' : `failed (${res.status})`}`);
  }

  // 5. Compare.
  const check = await connect(testUrl);
  const after = await counts(check);
  await check.end();
  console.log('live :', JSON.stringify(liveCounts));
  console.log('test :', JSON.stringify(after));
  const same = Object.keys(liveCounts).every((k) => liveCounts[k] === after[k]);
  console.log(same ? 'The test database matches the live structure.' : 'MISMATCH: see the counts above.');
  process.exit(same ? 0 : 1);
}

main().catch((e) => {
  console.error(hide(e?.message ?? e));
  process.exit(1);
});
