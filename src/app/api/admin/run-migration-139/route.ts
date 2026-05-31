export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getDbAsync } from '@/lib/db';
import { verifyAdminCookie } from '@/lib/admin-auth';

export async function GET() { return POST(); }

/**
 * Migration 139 — add contact_sales flag to directory_plans.
 *
 * When true the plan's price is hidden in the venue billing dashboard and
 * the upgrade CTA is replaced with a "Book a Strategy Call" button. Venues
 * already subscribed to the plan retain full self-serve management.
 *
 * Run once per environment. Idempotent.
 */
export async function POST() {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const sql = await getDbAsync();

    await sql`
      ALTER TABLE public.directory_plans
        ADD COLUMN IF NOT EXISTS contact_sales BOOLEAN NOT NULL DEFAULT FALSE
    `;

    await sql`SELECT pg_notify('pgrst', 'reload schema')`;

    return NextResponse.json({ ok: true, migration: 139 });
  } catch (err) {
    console.error('[run-migration-139]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
