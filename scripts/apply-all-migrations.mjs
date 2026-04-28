#!/usr/bin/env node
/**
 * Apply all hand-rolled migrations from /migrations in numeric order using pg
 * + SUPABASE_DB_URL. All migrations are idempotent (use IF NOT EXISTS), so
 * running this catches up an out-of-date database.
 *
 * Usage: node scripts/apply-all-migrations.mjs [from] [to]
 *   from/to are inclusive 3-digit prefixes, e.g. 008 069 (defaults: 008 069)
 */
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import { readFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const migrationsDir = join(repoRoot, 'migrations');
const envText = readFileSync(join(repoRoot, '.env.local'), 'utf8');
const dbUrl = (envText.match(/^SUPABASE_DB_URL\s*=\s*(.+)$/m) || [])[1]?.trim().replace(/^"|"$/g, '');
if (!dbUrl) {
  console.error('SUPABASE_DB_URL not found in .env.local');
  process.exit(1);
}

const from = process.argv[2] || '008';
const to   = process.argv[3] || '069';

const client = new pg.Client({ connectionString: dbUrl });
await client.connect();

const entries = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
const inRange = entries.filter((f) => {
  const m = f.match(/^(\d{3})_/);
  if (!m) return false;
  return m[1] >= from && m[1] <= to;
});

console.log(`Applying ${inRange.length} migrations: ${from} → ${to}`);

let ok = 0;
let failed = 0;
for (const file of inRange) {
  const sql = await readFile(join(migrationsDir, file), 'utf8');
  process.stdout.write(`→ ${file} (${sql.length} bytes) ... `);
  try {
    await client.query(sql);
    console.log('OK');
    ok++;
  } catch (e) {
    console.log(`FAIL`);
    console.error(`   ${e.message}`);
    failed++;
  }
}

console.log(`\nDone. ${ok} succeeded, ${failed} failed.`);
await client.end();
process.exit(failed ? 1 : 0);
