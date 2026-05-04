export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getDbAsync } from '@/lib/db';
import { verifyAdminCookie } from '@/lib/admin-auth';

/**
 * Migration 101 — AI Concierge outreach question pool.
 *
 * Adds `ai_config.outreach_questions JSONB` and seeds the active version
 * with a starter pool of questions. Idempotent.
 */
export async function GET() { return POST(); }

export async function POST() {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const sql         = await getDbAsync();
    const sqlPath     = path.join(process.cwd(), 'migrations', '101_ai_outreach_questions.sql');
    const migrationSql = await fs.readFile(sqlPath, 'utf8');

    await sql.unsafe(migrationSql);

    return NextResponse.json({
      success: true,
      message: 'Migration 101 applied — outreach_questions column added + active version seeded.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[migration-101]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
