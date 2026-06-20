import { NextResponse } from 'next/server';
import { getDbAsync } from '@/lib/db';
import { verifyMasterAdminOnly } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Migration 145 — add last_login_at (timestamptz) to public.venues so the
 * super-admin venue list can display when each owner last signed in.
 * Idempotent — safe to re-run.
 */
export async function POST() {
  if (!(await verifyMasterAdminOnly())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const sql = await getDbAsync();
    await sql.unsafe(`
      ALTER TABLE public.venues
        ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
    `);
    await sql.unsafe(`
      CREATE INDEX IF NOT EXISTS venues_last_login_at_idx
        ON public.venues (last_login_at DESC NULLS LAST);
    `);
    await sql.unsafe(`NOTIFY pgrst, 'reload schema';`);
    return NextResponse.json({ ok: true, migration: 145, message: 'venues.last_login_at added.' });
  } catch (err) {
    console.error('[run-migration-145]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET() { return POST(); }
