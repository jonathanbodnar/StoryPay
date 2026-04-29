import { NextResponse } from 'next/server';
import { getDbAsync } from '@/lib/db';
import { verifyAdminCookie } from '@/lib/admin-auth';

/**
 * GET/POST /api/admin/run-migration-077
 *
 * Adds first_name + last_name columns to couple_profiles. Backfills
 * those values from the existing display_name when possible.
 * Only callable by a verified admin session.
 */
export async function GET() { return POST(); }

export async function POST() {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const sql = await getDbAsync();

    await sql`
      ALTER TABLE public.couple_profiles
        ADD COLUMN IF NOT EXISTS first_name text,
        ADD COLUMN IF NOT EXISTS last_name  text
    `;

    // Best-effort backfill: split display_name on first whitespace
    await sql`
      UPDATE public.couple_profiles
      SET first_name = split_part(display_name, ' ', 1),
          last_name  = NULLIF(regexp_replace(display_name, '^\\S+\\s*', ''), '')
      WHERE display_name IS NOT NULL
        AND first_name IS NULL
    `;

    await sql`SELECT pg_notify('pgrst', 'reload schema')`;

    return NextResponse.json({ ok: true, message: 'Migration 077 applied successfully.' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[run-migration-077]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
