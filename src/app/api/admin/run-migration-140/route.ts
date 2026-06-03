export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getDbAsync } from '@/lib/db';
import { verifyAdminCookie } from '@/lib/admin-auth';

export async function GET() { return POST(); }

/**
 * Migration 140 — add admin_login_token to venues.
 *
 * A permanent, reusable UUID token for the admin "Copy login" button.
 * Never expires, never rotated. Completely separate from login_token.
 * Run once per environment. Idempotent.
 */
export async function POST() {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const sql = await getDbAsync();

    await sql`
      ALTER TABLE public.venues
        ADD COLUMN IF NOT EXISTS admin_login_token UUID DEFAULT gen_random_uuid()
    `;

    await sql`
      UPDATE public.venues
        SET admin_login_token = gen_random_uuid()
        WHERE admin_login_token IS NULL
    `;

    await sql`SELECT pg_notify('pgrst', 'reload schema')`;

    return NextResponse.json({ ok: true, migration: 140 });
  } catch (err) {
    console.error('[run-migration-140]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
