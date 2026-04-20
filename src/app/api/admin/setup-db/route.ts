import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

async function requireAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  return token && token === process.env.ADMIN_SECRET;
}

// Tables that must exist in production — creates them if missing.
// Run this once by visiting /admin and clicking Setup DB.
const TABLES = [
  {
    name: 'directory_feature_definitions',
    sql: `
      CREATE TABLE IF NOT EXISTS public.directory_feature_definitions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        feature_key text NOT NULL UNIQUE,
        label text NOT NULL,
        description text,
        category text,
        sort_order int NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE public.directory_feature_definitions DISABLE ROW LEVEL SECURITY;
    `,
  },
  {
    name: 'directory_plans',
    sql: `
      CREATE TABLE IF NOT EXISTS public.directory_plans (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL,
        slug text NOT NULL UNIQUE,
        description text,
        sort_order int NOT NULL DEFAULT 0,
        is_default boolean NOT NULL DEFAULT false,
        price_monthly_cents int,
        stripe_price_id text,
        fortis_merchant_id text,
        nav_permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
        feature_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE public.directory_plans DISABLE ROW LEVEL SECURITY;
    `,
  },
  {
    name: 'venue_team_members',
    sql: `
      CREATE TABLE IF NOT EXISTS public.venue_team_members (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        venue_id   uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
        first_name text,
        last_name  text,
        name       text,
        email      text NOT NULL,
        role       text NOT NULL DEFAULT 'member',
        status     text NOT NULL DEFAULT 'invited',
        avatar_url text,
        invited_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE public.venue_team_members ENABLE ROW LEVEL SECURITY;
    `,
  },
  {
    name: 'platform_billing_events',
    sql: `
      CREATE TABLE IF NOT EXISTS public.platform_billing_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        venue_id uuid REFERENCES public.venues(id) ON DELETE SET NULL,
        directory_plan_id uuid REFERENCES public.directory_plans(id) ON DELETE SET NULL,
        amount_cents int NOT NULL,
        currency text NOT NULL DEFAULT 'usd',
        fortis_merchant_id text,
        external_event_id text,
        event_type text NOT NULL,
        occurred_at timestamptz NOT NULL DEFAULT now(),
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS platform_billing_events_occurred_idx
        ON public.platform_billing_events (occurred_at DESC);
      CREATE INDEX IF NOT EXISTS platform_billing_events_venue_idx
        ON public.platform_billing_events (venue_id);
      ALTER TABLE public.platform_billing_events DISABLE ROW LEVEL SECURITY;
    `,
  },
  {
    name: 'venue_onboarding_steps',
    sql: `
      CREATE TABLE IF NOT EXISTS public.venue_onboarding_steps (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        venue_id     uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
        step         text NOT NULL,
        completed_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (venue_id, step)
      );
      ALTER TABLE public.venue_onboarding_steps ENABLE ROW LEVEL SECURITY;
    `,
  },
];

const COLUMNS = [
  { table: 'venues', column: 'brand_bg_color',               sql: `ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS brand_bg_color text;` },
  { table: 'venues', column: 'brand_btn_text',               sql: `ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS brand_btn_text text;` },
  { table: 'venues', column: 'onboarding_checklist_dismissed', sql: `ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS onboarding_checklist_dismissed boolean NOT NULL DEFAULT false;` },
  { table: 'venues', column: 'onboarding_checklist_completed', sql: `ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS onboarding_checklist_completed boolean NOT NULL DEFAULT false;` },
  { table: 'venues', column: 'onboarding_steps_completed',    sql: `ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS onboarding_steps_completed jsonb NOT NULL DEFAULT '[]'::jsonb;` },
  { table: 'venues', column: 'ghl_access_token',              sql: `ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS ghl_access_token text;` },
  { table: 'venues', column: 'ghl_refresh_token',             sql: `ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS ghl_refresh_token text;` },
  { table: 'venues', column: 'ghl_location_token',            sql: `ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS ghl_location_token text;` },
  { table: 'venues', column: 'directory_verified_status',      sql: `ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS directory_verified_status text NOT NULL DEFAULT 'none';` },
  { table: 'venues', column: 'directory_sponsored_status',     sql: `ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS directory_sponsored_status text NOT NULL DEFAULT 'none';` },
  { table: 'venues', column: 'directory_plan_id',                sql: `ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS directory_plan_id uuid REFERENCES public.directory_plans(id) ON DELETE SET NULL;` },
  { table: 'directory_plans', column: 'fortis_merchant_id',      sql: `ALTER TABLE public.directory_plans ADD COLUMN IF NOT EXISTS fortis_merchant_id text;` },
  { table: 'directory_plans', column: 'nav_permissions',         sql: `ALTER TABLE public.directory_plans ADD COLUMN IF NOT EXISTS nav_permissions jsonb NOT NULL DEFAULT '{}'::jsonb;` },
  { table: 'venues', column: 'directory_subscription_status',    sql: `ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS directory_subscription_status text NOT NULL DEFAULT 'none';` },
  { table: 'venues', column: 'directory_subscription_external_id', sql: `ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS directory_subscription_external_id text;` },
  { table: 'venues', column: 'platform_lunarpay_customer_id', sql: `ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS platform_lunarpay_customer_id text;` },
];

export async function POST() {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const results: { name: string; status: string; error?: string }[] = [];

  for (const t of TABLES) {
    try {
      // Check if table exists
      const { error: checkErr } = await supabaseAdmin
        .from(t.name)
        .select('id')
        .limit(1);

      if (!checkErr) {
        results.push({ name: t.name, status: 'exists' });
        continue;
      }

      // Table missing — we can't run DDL directly via supabase-js.
      // Return the SQL for the admin to run manually in the Supabase SQL editor.
      results.push({ name: t.name, status: 'missing', error: t.sql.trim() });
    } catch (e) {
      results.push({ name: t.name, status: 'error', error: String(e) });
    }
  }

  for (const c of COLUMNS) {
    try {
      const { error } = await supabaseAdmin
        .from(c.table)
        .select(c.column)
        .limit(1);
      if (!error) {
        results.push({ name: `${c.table}.${c.column}`, status: 'exists' });
      } else {
        results.push({ name: `${c.table}.${c.column}`, status: 'missing', error: c.sql });
      }
    } catch (e) {
      results.push({ name: `${c.table}.${c.column}`, status: 'error', error: String(e) });
    }
  }

  const missing = results.filter(r => r.status === 'missing');
  return NextResponse.json({ results, missing, sqlToRun: missing.map(m => m.error).join('\n\n') });
}
