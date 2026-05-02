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
      ALTER TABLE public.venues
        ADD COLUMN IF NOT EXISTS directory_addon_verified BOOLEAN NOT NULL DEFAULT FALSE
    `;
    await sql`
      ALTER TABLE public.venues
        ADD COLUMN IF NOT EXISTS directory_addon_sponsored BOOLEAN NOT NULL DEFAULT FALSE
    `;

    await sql`SELECT pg_notify('pgrst', 'reload schema')`;

    return NextResponse.json({
      success: true,
      message: 'Migration 092 applied — directory_addon_verified / directory_addon_sponsored columns added.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[migration-092]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
