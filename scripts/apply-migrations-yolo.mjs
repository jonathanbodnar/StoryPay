#!/usr/bin/env node
// One-shot: apply hand-rolled migrations from /migrations via Supabase's
// Management API. Reads SUPABASE_ACCESS_TOKEN + PROJECT_REF from argv/env.
//
// Usage:
//   SUPABASE_ACCESS_TOKEN=... PROJECT_REF=... \
//     node scripts/apply-migrations-yolo.mjs 024 025 026
//
// All migrations in this repo are written to be idempotent.
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.PROJECT_REF;
if (!token || !ref) {
  console.error('SUPABASE_ACCESS_TOKEN and PROJECT_REF required');
  process.exit(1);
}

const args = process.argv.slice(2);
if (!args.length) {
  console.error('Pass one or more migration numbers, e.g. 024 025 026');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const migrationsDir = join(repoRoot, 'migrations');

async function runSql(query) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    },
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return text;
}

async function main() {
  const entries = await readdir(migrationsDir);
  for (const num of args) {
    const match = entries.find(
      (f) => f.startsWith(`${num}_`) && f.endsWith('.sql'),
    );
    if (!match) {
      console.error(`No migration found for ${num} in ${migrationsDir}`);
      process.exit(1);
    }
    const sql = await readFile(join(migrationsDir, match), 'utf8');
    console.log(`\n--- applying ${match} (${sql.length} bytes) ---`);
    const out = await runSql(sql);
    console.log(`✓ ${match}`);
    if (out && out.length < 400) console.log(out);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
