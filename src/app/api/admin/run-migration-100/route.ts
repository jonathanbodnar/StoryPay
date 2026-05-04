export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getDbAsync } from '@/lib/db';
import { verifyAdminCookie } from '@/lib/admin-auth';

/**
 * Migration 100 — AI Concierge A2P verification cache + per-venue spend caps.
 *
 * Adds:
 *   - venues.a2p_* columns (cached brand/campaign IDs and statuses)
 *   - venues.ai_daily_send_cap, ai_daily_alert_threshold_pct, ai_alert_last_sent_at
 *   - ai_runtime_settings.default_daily_send_cap
 *
 * Idempotent.
 */
export async function GET() { return POST(); }

export async function POST() {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const sql         = await getDbAsync();
    const sqlPath     = path.join(process.cwd(), 'migrations', '100_ai_a2p_and_spend_caps.sql');
    const migrationSql = await fs.readFile(sqlPath, 'utf8');

    await sql.unsafe(migrationSql);

    return NextResponse.json({
      success: true,
      message: 'Migration 100 applied — A2P cache + per-venue spend caps installed.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[migration-100]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
