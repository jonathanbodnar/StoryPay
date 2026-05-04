export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getDbAsync } from '@/lib/db';
import { verifyAdminCookie } from '@/lib/admin-auth';

/**
 * Migration 102 — AI Concierge cron heartbeat columns.
 *
 * Adds last_activation_cron_at + last_send_cron_at to ai_runtime_settings.
 * Idempotent.
 */
export async function GET() { return POST(); }

export async function POST() {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const sql         = await getDbAsync();
    const sqlPath     = path.join(process.cwd(), 'migrations', '102_ai_cron_heartbeat.sql');
    const migrationSql = await fs.readFile(sqlPath, 'utf8');
    await sql.unsafe(migrationSql);
    return NextResponse.json({
      success: true,
      message: 'Migration 102 applied — cron heartbeat columns added.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[migration-102]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
