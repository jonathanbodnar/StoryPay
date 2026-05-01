export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getDbAsync } from '@/lib/db';
import { verifyAdminCookie } from '@/lib/admin-auth';

/**
 * GET/POST /api/admin/run-migration-080
 *
 * Adds ghl_dnd_settings and ghl_inbound_dnd_settings JSONB columns to
 * venue_customers so GHL per-channel DND state can be synced and persisted.
 */
export async function GET() { return POST(); }

export async function POST() {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const sql = await getDbAsync();

    await sql`
      ALTER TABLE public.venue_customers
        ADD COLUMN IF NOT EXISTS ghl_dnd_settings jsonb,
        ADD COLUMN IF NOT EXISTS ghl_inbound_dnd_settings jsonb
    `;

    await sql`SELECT pg_notify('pgrst', 'reload schema')`;

    return NextResponse.json({ success: true, message: 'Migration 080 applied — ghl_dnd_settings columns added' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[migration-080]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
