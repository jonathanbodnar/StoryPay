export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getDbAsync } from '@/lib/db';
import { verifyAdminCookie } from '@/lib/admin-auth';

export async function GET() { return POST(); }

export async function POST() {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const sql = await getDbAsync();

    await sql`
      ALTER TABLE public.directory_plans
        ADD COLUMN IF NOT EXISTS trial_period_value INTEGER NOT NULL DEFAULT 0
    `;
    await sql`
      ALTER TABLE public.directory_plans
        ADD COLUMN IF NOT EXISTS trial_period_unit TEXT NOT NULL DEFAULT 'none'
    `;
    // Best-effort constraint add — ignore if already present.
    try {
      await sql`
        ALTER TABLE public.directory_plans
          ADD CONSTRAINT directory_plans_trial_period_unit_check
          CHECK (trial_period_unit IN ('none', 'days', 'weeks', 'months', 'years', 'forever'))
      `;
    } catch {
      // already exists
    }

    await sql`
      ALTER TABLE public.venues
        ADD COLUMN IF NOT EXISTS directory_trial_started_at TIMESTAMPTZ NULL
    `;
    await sql`
      ALTER TABLE public.venues
        ADD COLUMN IF NOT EXISTS directory_trial_ends_at TIMESTAMPTZ NULL
    `;
    await sql`
      ALTER TABLE public.venues
        ADD COLUMN IF NOT EXISTS directory_trial_is_forever BOOLEAN NOT NULL DEFAULT FALSE
    `;
    await sql`
      ALTER TABLE public.venues
        ADD COLUMN IF NOT EXISTS directory_trial_plan_id UUID NULL
    `;
    await sql`
      ALTER TABLE public.venues
        ADD COLUMN IF NOT EXISTS directory_trial_consumed BOOLEAN NOT NULL DEFAULT FALSE
    `;
    try {
      await sql`
        ALTER TABLE public.venues
          ADD CONSTRAINT venues_directory_trial_plan_id_fkey
          FOREIGN KEY (directory_trial_plan_id)
          REFERENCES public.directory_plans(id)
          ON DELETE SET NULL
      `;
    } catch {
      // already exists or plan id null
    }

    await sql`SELECT pg_notify('pgrst', 'reload schema')`;

    return NextResponse.json({
      success: true,
      message: 'Migration 093 applied — directory plan trial periods + venue trial state.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[migration-093]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
