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
    const sqlPath = path.join(process.cwd(), 'migrations', '106_support_inbox.sql');
    const migSql  = await fs.readFile(sqlPath, 'utf8');
    await sql.unsafe(migSql);
    return NextResponse.json({
      success: true,
      message: 'Migration 106 applied — support inbox schema installed.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[migration-106]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
