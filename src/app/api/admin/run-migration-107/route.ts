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
    const sql = await getDbAsync();

    // Run 107 first (adds opened_by_member_id column, drops NOT NULL on profile_id)
    const path107 = path.join(process.cwd(), 'migrations', '107_support_thread_member_attribution.sql');
    const sql107  = await fs.readFile(path107, 'utf8');
    await sql.unsafe(sql107);

    // Then run 111 (relaxes constraint to allow both NULL for profile-only owners)
    const path111 = path.join(process.cwd(), 'migrations', '111_support_owner_no_profile.sql');
    const sql111  = await fs.readFile(path111, 'utf8');
    await sql.unsafe(sql111);

    return NextResponse.json({
      success: true,
      message: 'Migrations 107 + 111 applied — support tickets now work for all venue owner types.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[migration-107+111]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
