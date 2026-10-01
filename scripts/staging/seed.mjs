#!/usr/bin/env node
/**
 * Fill the test copy's database with what it needs to run:
 *   - product settings copied from live (plans, add-on prices, fee tiers,
 *     feature definitions, email templates, merge fields, AI and booking-system
 *     defaults). No customer data. Live Stripe price ids are blanked: they
 *     don't exist in Stripe's test mode.
 *   - a fake demo venue on the Bride Booking System plan, with fake leads
 *     (example.com emails and 555-01xx numbers, so nothing can reach a person).
 *
 *   railway run --service "StoryVenue Backend" --environment Dev -- node scripts/staging/seed.mjs
 *
 * The demo owner signs in with ADMIN_EMAIL and STAGING_PASSWORD. Safe to rerun:
 * settings are only added, and the demo rows have fixed ids.
 */

import { readFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const LIVE_SUPABASE_REF = 'brnxhsaakmhgwcthcapd';
const hide = (s) => String(s).replace(/postgres(ql)?:\/\/\S+/g, '[connection hidden]');

const SETTINGS_TABLES = [
  'directory_feature_definitions', 'directory_plans', 'platform_addon_prices', 'platform_payment_fee_tiers',
  'booking_system_stage_defaults', 'admin_project_stages', 'handoff_rules', 'system_email_templates',
  'system_merge_variables', 'funnel_pages', 'funnel_variants', 'ai_config', 'ai_runtime_settings',
];
const BLANK = { directory_plans: ['stripe_price_id'], platform_addon_prices: ['stripe_price_id'] };

const DEMO_VENUE_ID = 'f0e1d2c3-b4a5-4697-8879-6a5b4c3d2e1f';
const BOOKING_SYSTEM_PLAN_SLUG = 'bride-booking-system';

const LEADS = [
  ['Avery Thompson', 'directory', '2027-06-12', 150, true],
  ['Jordan Ellis', 'embed', '2027-09-25', 120, true],
  ['Riley Morgan', 'form', '2027-05-08', 200, false],
  ['Casey Bennett', 'lead_link', '2027-10-16', 90, true],
  ['Taylor Brooks', 'contact', '2027-08-21', 175, false],
  ['Morgan Reyes', 'directory', '2028-04-29', 130, true],
  ['Quinn Harper', 'embed', '2027-07-03', 80, false],
  ['Skyler James', 'form', '2027-11-06', 160, true],
];

async function main() {
  const liveUrl = (readFileSync('.env.local', 'utf8').match(/^SUPABASE_DB_URL\s*=\s*(.+)$/m) || [])[1]?.trim().replace(/^"|"$/g, '');
  const testUrl = (process.env.SUPABASE_DB_URL || '').trim();
  const ownerEmail = (process.env.ADMIN_EMAIL || '').trim();
  const password = (process.env.STAGING_PASSWORD || '').trim();
  if (process.env.APP_ENV !== 'staging') throw new Error('Run this with railway run --environment Dev (APP_ENV=staging).');
  if (!liveUrl?.includes(LIVE_SUPABASE_REF)) throw new Error('.env.local SUPABASE_DB_URL is not the live database');
  if (!testUrl || testUrl.includes(LIVE_SUPABASE_REF)) throw new Error('The target must be the test database. Stopping.');
  if (!ownerEmail || !password) throw new Error('ADMIN_EMAIL and STAGING_PASSWORD must be set in the Dev environment.');

  const connect = async (url) => {
    const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
    await c.connect();
    return c;
  };
  const live = await connect(liveUrl);
  const test = await connect(testUrl);

  // 1. Product settings (read from live, added to the test copy).
  for (const table of SETTINGS_TABLES) {
    const { rows } = await live.query(`select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as rows from public.${table} t`);
    const data = rows[0].rows.map((r) => {
      for (const col of BLANK[table] ?? []) r[col] = null;
      return r;
    });
    const res = await test.query(
      `insert into public.${table} select * from jsonb_populate_recordset(null::public.${table}, $1::jsonb) on conflict do nothing`,
      [JSON.stringify(data)],
    );
    console.log(`${table}: ${data.length} on live, ${res.rowCount} added`);
  }
  await live.end();

  // 2. The demo venue (fixed id, so a rerun updates it).
  const plan = (await test.query('select id from public.directory_plans where slug = $1', [BOOKING_SYSTEM_PLAN_SLUG])).rows[0];
  if (!plan) throw new Error('The Bride Booking System plan was not copied.');
  await test.query(
    `insert into public.venues (id, name, slug, email, notification_email, brand_email, brand_phone, password_hash,
       setup_completed, onboarding_status, directory_plan_id, directory_subscription_status, email_verified_at,
       owner_first_name, owner_last_name, location_city, location_state, location_full, timezone, brand_color,
       venue_type, capacity_min, capacity_max, description, is_published, is_demo)
     values ($1, 'Maple Hollow Barn (Test)', 'maple-hollow-test', $2, $2, $2, '+12125550100', $3,
       true, 'registered', $4, 'active', now(),
       'Test', 'Owner', 'Asheville', 'NC', '123 Test Lane, Asheville, NC 28801', 'America/New_York', '#1b1b1b',
       'barn', 50, 220, 'A fake venue for the StoryVenue test copy.', true, false)
     on conflict (id) do update set email = excluded.email, notification_email = excluded.notification_email,
       brand_email = excluded.brand_email, password_hash = excluded.password_hash,
       directory_plan_id = excluded.directory_plan_id, directory_subscription_status = excluded.directory_subscription_status`,
    [DEMO_VENUE_ID, ownerEmail, await bcrypt.hash(password, 10), plan.id],
  );
  console.log('demo venue: Maple Hollow Barn (Test), sign in with ADMIN_EMAIL + STAGING_PASSWORD');

  // 3. Fake leads.
  let n = 0;
  for (const [name, source, weddingDate, guests, consent] of LEADS) {
    n++;
    const id = `f0e1d2c3-b4a5-4697-8879-0000000000${String(n).padStart(2, '0')}`;
    const [first, last] = name.split(' ');
    await test.query(
      `insert into public.leads (id, venue_id, name, first_name, last_name, email, phone, source, wedding_date, guest_count,
         status, message, sms_consent, sms_consent_at, sms_consent_source)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'new', 'Hi! We would love pricing and available dates.', $11,
         case when $11 then now() end, case when $11 then 'test_seed' end)
       on conflict (id) do nothing`,
      [id, DEMO_VENUE_ID, name, first, last, `${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
        `+1212555${String(100 + n).padStart(4, '0')}`, source, weddingDate, guests, consent],
    );
  }
  console.log(`fake leads: ${LEADS.length}`);
  await test.end();
}

main().catch((e) => {
  console.error(hide(e?.message ?? e));
  process.exit(1);
});
