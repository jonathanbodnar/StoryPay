export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getDbAsync } from '@/lib/db';
import { verifyAdminCookie } from '@/lib/admin-auth';

export async function GET() { return POST(); }

export async function POST() {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const sql     = await getDbAsync();
    const sqlPath = path.join(process.cwd(), 'migrations', '202_per_person_notification_settings.sql');
    const migSql  = await fs.readFile(sqlPath, 'utf8');
    await sql.unsafe(migSql);
    return NextResponse.json({
      success: true,
      message: 'Migration 202 applied — per-person notification_settings jsonb added to venues and venue_team_members, Venue Direct prefs carried forward.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[migration-202]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
