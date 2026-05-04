export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getDbAsync } from '@/lib/db';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { clearAiConfigCache } from '@/lib/ai-concierge/prompt-builder';

/**
 * Migration 103 — Seed 15 polished reply-trigger outreach messages onto the
 * active ai_config version. Idempotent (guarded by sentinel string).
 *
 * Also clears the in-process ai_config cache so the next cron tick reads the
 * fresh pool without waiting for the 60s TTL.
 */
export async function GET() { return POST(); }

export async function POST() {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const sql = await getDbAsync();
    const sqlPath = path.join(process.cwd(), 'migrations', '103_ai_outreach_seed_v2.sql');
    const migrationSql = await fs.readFile(sqlPath, 'utf8');
    await sql.unsafe(migrationSql);

    clearAiConfigCache();

    return NextResponse.json({
      success: true,
      message: 'Migration 103 applied — 15 reply-trigger messages appended to active outreach pool.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[migration-103]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
