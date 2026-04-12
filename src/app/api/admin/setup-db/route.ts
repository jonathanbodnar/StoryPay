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
