import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyMasterAdminOnly } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Migration 138 — add blocking + admin-notes columns to every contact table
 * powering the new super-admin Contacts page.
 *
 *   venues, couple_profiles, venue_team_members, support_team_members
 *
 * Run once per environment. Idempotent.
 */
export async function POST() {
  if (!(await verifyMasterAdminOnly())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const statements: { label: string; sql: string }[] = [
    {
      label: 'venues block columns',
      sql: `ALTER TABLE public.venues
              ADD COLUMN IF NOT EXISTS blocked_until  timestamptz,
              ADD COLUMN IF NOT EXISTS blocked_reason text,
              ADD COLUMN IF NOT EXISTS admin_notes    text;`,
    },
    {
      label: 'couple_profiles block columns',
      sql: `ALTER TABLE public.couple_profiles
              ADD COLUMN IF NOT EXISTS blocked_until  timestamptz,
              ADD COLUMN IF NOT EXISTS blocked_reason text,
              ADD COLUMN IF NOT EXISTS admin_notes    text;`,
    },
    {
      label: 'venue_team_members block + phone columns',
      sql: `ALTER TABLE public.venue_team_members
              ADD COLUMN IF NOT EXISTS phone          text,
              ADD COLUMN IF NOT EXISTS blocked_until  timestamptz,
              ADD COLUMN IF NOT EXISTS blocked_reason text,
              ADD COLUMN IF NOT EXISTS admin_notes    text;`,
    },
    {
      label: 'support_team_members phone + notes columns',
      sql: `ALTER TABLE public.support_team_members
              ADD COLUMN IF NOT EXISTS phone       text,
              ADD COLUMN IF NOT EXISTS admin_notes text;`,
    },
    {
      label: 'reload PostgREST schema cache',
      sql: `NOTIFY pgrst, 'reload schema';`,
    },
  ];

  const steps: string[] = [];
  for (const s of statements) {
    const { error } = await supabaseAdmin.rpc('exec_sql' as never, { sql: s.sql } as never);
    if (error) {
      return NextResponse.json(
        { error: error.message, step: s.label, applied: steps },
        { status: 500 },
      );
    }
    steps.push(s.label);
  }

  return NextResponse.json({ ok: true, steps });
}
