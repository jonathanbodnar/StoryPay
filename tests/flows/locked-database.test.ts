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

  // The storyvenue.com directory site (its own repo, ~/weddingdirectory)
  // reads these three tables directly with the public key; migration 277
  // reopened them after 276 broke every venue list there (Oct 3 outage).
  // Each is safe because the COLUMN grants below keep secrets unreadable.
  const REVIEWED_PUBLIC_READS = [
    'venues: Public can read published venues',
    'venue_pricing_guides: anon_select_venue_pricing_guides',
    'directory_plans: anon_select_directory_plans',
  ];

  it('no table grants the public roles a way in by policy, beyond the reviewed directory reads', async () => {
    // Belt and braces for empty tables: no permissive policy may let the
    // anon/authenticated roles read or write, except ones keyed to the
    // signed-in user by auth.uid() (none of those exist today), an admin
    // profiles row the server controls (is_admin()), or the reviewed
    // directory reads above.
    const rows = await sql<{ tablename: string; policyname: string; roles: string; qual: string | null; with_check: string | null }[]>`
      select tablename, policyname, roles::text as roles, qual, with_check
      from pg_policies where schemaname = 'public' and permissive = 'PERMISSIVE'`;
    const openings = rows.filter((p) => {
      if (!/anon|authenticated|public/.test(p.roles) || /service_role/.test(p.roles)) return false;
      const gate = `${p.qual ?? ''} ${p.with_check ?? ''}`;
      if (/^\s*false\s*(false)?\s*$/.test(gate)) return false; // deny-style
      return !/auth\.uid\(\)|is_admin\(\)/.test(gate); // keyed to a signed-in user or a server-set admin
    });
    expect(openings.map((p) => `${p.tablename}: ${p.policyname}`).sort()).toEqual([...REVIEWED_PUBLIC_READS].sort());
  });

  it('the directory’s public reads stay exactly as wide as the directory needs', async () => {
    // The width of each reviewed read is the COLUMN grant, held still here:
    // widen it only together with ~/weddingdirectory, narrow it only after
    // checking that repo's queries (its db/020-024 define the original list).
    const GRANTED: Record<string, string[]> = {
      venues: [
        'availability_notes', 'brand_website', 'capacity_max', 'capacity_min', 'cover_image_url',
        'created_at', 'demo_preview_token', 'description', 'directory_plan_id', 'directory_sponsored_status',
        'directory_verified_status', 'email', 'faq', 'features', 'gallery_images', 'google_place_id',
        'google_reviews_cache', 'google_reviews_fetched_at', 'id', 'indoor_outdoor', 'is_demo', 'is_published',
        'lat', 'lead_link_links', 'lng', 'location_city', 'location_full', 'location_state', 'meta_pixel_id',
        'name', 'phone', 'price_max', 'price_min', 'seo_description', 'seo_keywords', 'seo_title',
        'show_map', 'slug', 'social_links', 'updated_at', 'venue_type',
      ],
      venue_pricing_guides: ['cover_image_url', 'enabled', 'id', 'venue_id'],
      directory_plans: ['hide_header', 'id', 'nav_permissions'],
    };
    for (const [table, expected] of Object.entries(GRANTED)) {
      // No table-wide SELECT for the public roles (that would bypass the column list)…
      const wide = await sql<{ grantee: string }[]>`
        select grantee from information_schema.table_privileges
        where table_schema = 'public' and table_name = ${table}
          and privilege_type = 'SELECT' and grantee in ('anon', 'authenticated')`;
      expect(wide, `${table}: table-wide grant`).toEqual([]);
      // …and the column list is exactly the contract.
      const cols = await sql<{ column_name: string }[]>`
        select distinct column_name from information_schema.column_privileges
        where table_schema = 'public' and table_name = ${table}
          and privilege_type = 'SELECT' and grantee = 'anon'`;
      expect(cols.map((c) => c.column_name).sort(), table).toEqual(expected);
    }

    // And the reads behave: published venues answer the public key with safe
    // columns (this is the directory working), secrets answer 401, and
    // unpublished venues stay invisible.
    const anon = String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const rest = (q: string) => fetch(`${env.supabaseUrl}/rest/v1/${q}`, {
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
    });
    const listing = await rest('venues?select=name,slug,cover_image_url&is_published=eq.true&limit=5');
    expect(listing.status).toBe(200);
    expect(((await listing.json()) as unknown[]).length).toBeGreaterThan(0);
    for (const secret of ['password_hash', 'login_token', 'ghl_access_token', 'calendly_webhook_signing_key']) {
      expect((await rest(`venues?select=${secret}&limit=1`)).status, secret).toBe(401);
    }
    const hidden = await rest('venues?select=slug&is_published=eq.false&limit=1');
    expect(hidden.status).toBe(200);
    expect(((await hidden.json()) as unknown[]).length).toBe(0);
    expect((await rest('venue_pricing_guides?select=cover_image_url,enabled&limit=1')).status).toBe(200);
    expect((await rest('venue_pricing_guides?select=about_venue&limit=1')).status).toBe(401);
    expect((await rest('directory_plans?select=id,nav_permissions,hide_header&limit=1')).status).toBe(200);
    expect((await rest('directory_plans?select=stripe_price_id&limit=1')).status).toBe(401);
  });

  it('every table has row security switched on', async () => {
    const rows = await sql<{ relname: string }[]>`
      select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`;
    expect(rows.map((r) => r.relname).sort()).toEqual([]);
  });
});
