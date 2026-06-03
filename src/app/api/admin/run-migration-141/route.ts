export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getDbAsync } from '@/lib/db';
import { verifyAdminCookie } from '@/lib/admin-auth';

export async function GET() { return POST(); }

/**
 * Migration 141 — hide the Booking System plan from all public-facing UIs.
 *
 * Sets is_public = FALSE on any plan whose name or slug matches
 * "booking*system". The plan is preserved in the DB so existing subscribers
 * keep their subscription; it just won't appear in the signup plan picker or
 * the venue billing page for new sign-ups. Upgrades to this tier are now
 * handled via a sales/demo call only.
 *
 * Idempotent — safe to run multiple times.
 */
export async function POST() {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const sql = await getDbAsync();

    const updated = await sql<{ id: string; name: string }[]>`
      UPDATE public.directory_plans
         SET is_public = FALSE
       WHERE LOWER(TRIM(name)) LIKE '%booking%system%'
          OR LOWER(TRIM(slug)) LIKE '%booking%system%'
       RETURNING id, name
    `;

    return NextResponse.json({ ok: true, migration: 141, updated });
  } catch (err) {
    console.error('[run-migration-141]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
