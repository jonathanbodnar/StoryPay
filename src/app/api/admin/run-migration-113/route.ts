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
    const sqlPath = path.join(process.cwd(), 'migrations', '113_admin_team_members.sql');
    const migSql  = await fs.readFile(sqlPath, 'utf8');
    await sql.unsafe(migSql);
    return NextResponse.json({
      success: true,
      message: 'Migration 113 applied — support_team_members extended with first_name, last_name, avatar_url, admin_tabs_allowed, is_super_admin.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[migration-113]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
