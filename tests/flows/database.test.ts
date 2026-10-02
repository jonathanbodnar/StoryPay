import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from './helpers';

// The database has everything the code uses: every table it reads or writes,
// every column list it selects (joins included), every database function it
// calls. Read from the code and checked against the test copy, whose structure
// matches the live database. (On Sep 30 eight tables the code relied on were
// missing live; on Oct 2 a join that had become ambiguous was found breaking
// the AI Concierge's Snooze.)

const SRC = join(__dirname, '..', '..', 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

const tables = new Set<string>();
const selects = new Map<string, Set<string>>(); // table → column lists
const rpcs = new Set<string>();

for (const file of walk(SRC)) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/([A-Za-z_$][\w$]*)\s*\.from\(\s*['"]([a-z_][a-z0-9_]*)['"]\s*\)/g)) {
    if (['storage', 'Buffer', 'Array'].includes(m[1])) continue;
    const table = m[2];
    tables.add(table);
    // The column list selected in the same chain, when it's written out in full.
    const rest = src.slice(m.index! + m[0].length, m.index! + m[0].length + 600);
    const chain = rest.split(/;|\.from\(/)[0];
    // A list written in pieces ('a, b,' + 'c') is read whole; one with ${...} isn't checked.
    const sel = chain.match(/\.select\(((?:\s*(?:'[^']*'|"[^"]*"|`[^`$]*`)\s*\+?)+)\s*[,)]/);
    const cols = sel?.[1]
      ? [...sel[1].matchAll(/'([^']*)'|"([^"]*)"|`([^`$]*)`/g)].map((p) => p[1] ?? p[2] ?? p[3]).join('').replace(/\s+/g, ' ').trim()
      : '';
    // Two-factor sign-in is off (TWOFA_ENABLED): its columns arrive with migration 125 when it's switched on.
    if (cols && !(process.env.TWOFA_ENABLED !== 'true' && cols.includes('totp_'))) {
      (selects.get(table) ?? selects.set(table, new Set()).get(table)!).add(cols);
    }
  }
  for (const m of src.matchAll(/\.rpc\(\s*['"]([a-z_][a-z0-9_]*)['"]/g)) rpcs.add(m[1]);
}

describe('the database has everything the code uses', () => {
  let sql: postgres.Sql;

  beforeAll(() => {
    sql = postgres(String(process.env.SUPABASE_DB_URL), { max: 1 });
  });
  afterAll(async () => { await sql?.end(); });

  it('every table and view', async () => {
    const rows = await sql<{ table_name: string }[]>`select table_name from information_schema.tables where table_schema = 'public'`;
    const have = new Set(rows.map((r) => r.table_name));
    expect([...tables].filter((t) => !have.has(t)).sort()).toEqual([]);
  });

  it('every database function', async () => {
    const rows = await sql<{ proname: string }[]>`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`;
    const have = new Set(rows.map((r) => r.proname));
    expect([...rpcs].filter((f) => !have.has(f)).sort()).toEqual([]);
  });

  it('every column list it selects, joins included', async () => {
    const pairs = [...selects].flatMap(([table, set]) => [...set].map((cols) => ({ table, cols })));
    const broken: string[] = [];
    let next = 0;
    await Promise.all(Array.from({ length: 8 }, async () => {
      while (next < pairs.length) {
        const { table, cols } = pairs[next++];
        const { error } = await db.from(table).select(cols).limit(0);
        if (error) broken.push(`${table}: select('${cols.slice(0, 120)}') → ${error.message}`);
      }
    }));
    expect(broken.sort()).toEqual([]);
  }, 180_000);
});
