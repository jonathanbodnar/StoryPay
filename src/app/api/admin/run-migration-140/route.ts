export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getDbAsync } from '@/lib/db';
import { verifyAdminCookie } from '@/lib/admin-auth';

export async function GET() { return POST(); }

/**
 * Migration 140 — enable contact_sales on the highest-priced plan.
 *
 * Ensures the contact_sales column exists (idempotent from migration 139)
 * and sets contact_sales = TRUE on the plan with the highest
 * price_monthly_cents, replacing the self-serve upgrade CTA with a
 * "Book a Demo Call" button for that tier.
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

    const updated = await sql<{ id: string; name: string }[]>`
      UPDATE public.directory_plans
         SET contact_sales = TRUE
       WHERE id = (
         SELECT id
           FROM public.directory_plans
          WHERE COALESCE(price_monthly_cents, 0) = (
                  SELECT MAX(COALESCE(price_monthly_cents, 0))
                    FROM public.directory_plans
                )
          ORDER BY sort_order ASC
          LIMIT 1
       )
       RETURNING id, name
    `;

    await sql`SELECT pg_notify('pgrst', 'reload schema')`;

    return NextResponse.json({ ok: true, migration: 140, updated: updated[0] ?? null });
  } catch (err) {
    console.error('[run-migration-140]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
