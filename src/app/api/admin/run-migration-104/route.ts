export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getDbAsync } from '@/lib/db';
import { verifyAdminCookie } from '@/lib/admin-auth';

/**
 * Migration 104 — ai_concierge_eligible flag on marketing_automations.
 *
 * Adds a boolean column (default true) that lets venues control which of
 * their workflows feeds into AI Concierge lead activation.
 */
export async function GET() { return POST(); }

export async function POST() {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const sql      = await getDbAsync();
    const sqlPath  = path.join(process.cwd(), 'migrations', '104_workflow_ai_concierge_eligible.sql');
    const migSql   = await fs.readFile(sqlPath, 'utf8');
    await sql.unsafe(migSql);
    return NextResponse.json({
      success: true,
      message: 'Migration 104 applied — ai_concierge_eligible column added to marketing_automations.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[migration-104]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
