import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { coupleSession, env } from './helpers';

// The database itself is locked, not just the app's routes. The public key
// ships in every browser, and anyone can point it (or a couple's sign-in)
// straight at the database, skipping the app. Every table must refuse both.
// (On Oct 3 the public key could read every published venue's password hash,
// sign-in token and GHL/Calendly/LunarPay keys this way — migration 276.)
describe('the database refuses the public keys on every table', () => {
  let sql: postgres.Sql;
  let tables: string[] = [];
  let coupleToken = '';

  beforeAll(async () => {
    sql = postgres(String(process.env.SUPABASE_DB_URL), { max: 1 });
    const rows = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`;
    tables = rows.map((r) => r.table_name);
    expect(tables.length).toBeGreaterThan(100);
    coupleToken = (await coupleSession()).access_token;
  });
  afterAll(async () => { await sql?.end(); });

  /** Rows PostgREST hands back for a table, as the public key or a couple. */
  async function readableRows(table: string, bearer: string): Promise<number> {
    const res = await fetch(`${env.supabaseUrl}/rest/v1/${table}?select=*&limit=1`, {
      headers: { apikey: String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY), Authorization: `Bearer ${bearer}` },
    });
    if (!res.ok) return 0; // refused outright is locked too
    const rows = (await res.json()) as unknown[];
    return Array.isArray(rows) ? rows.length : 0;
  }

  it('a stranger with the public key reads nothing from any table', async () => {
    const anon = String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const open: string[] = [];
    let next = 0;
    await Promise.all(Array.from({ length: 8 }, async () => {
      while (next < tables.length) {
        const table = tables[next++];
        if ((await readableRows(table, anon)) > 0) open.push(table);
      }
    }));
    expect(open.sort()).toEqual([]);
  }, 120_000);

  it('a signed-in couple reads nothing from any table either', async () => {
    const open: string[] = [];
    let next = 0;
    await Promise.all(Array.from({ length: 8 }, async () => {
      while (next < tables.length) {
        const table = tables[next++];
        if ((await readableRows(table, coupleToken)) > 0) open.push(table);
      }
    }));
    expect(open.sort()).toEqual([]);
  }, 120_000);

  it('no table grants the public roles a way in by policy', async () => {
    // Belt and braces for empty tables: no permissive policy may let the
    // anon/authenticated roles read or write, except ones keyed to the
    // signed-in user by auth.uid() (none of those exist today) or an admin
    // profiles row the server controls (is_admin()).
    const rows = await sql<{ tablename: string; policyname: string; roles: string; qual: string | null; with_check: string | null }[]>`
      select tablename, policyname, roles::text as roles, qual, with_check
      from pg_policies where schemaname = 'public' and permissive = 'PERMISSIVE'`;
    const openings = rows.filter((p) => {
      if (!/anon|authenticated|public/.test(p.roles) || /service_role/.test(p.roles)) return false;
      const gate = `${p.qual ?? ''} ${p.with_check ?? ''}`;
      if (/^\s*false\s*(false)?\s*$/.test(gate)) return false; // deny-style
      return !/auth\.uid\(\)|is_admin\(\)/.test(gate); // keyed to a signed-in user or a server-set admin
    });
    expect(openings.map((p) => `${p.tablename}: ${p.policyname}`).sort()).toEqual([]);
  });

  it('every table has row security switched on', async () => {
    const rows = await sql<{ relname: string }[]>`
      select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`;
    expect(rows.map((r) => r.relname).sort()).toEqual([]);
  });
});
