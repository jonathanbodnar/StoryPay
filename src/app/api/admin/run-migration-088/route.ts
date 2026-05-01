export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getDbAsync } from '@/lib/db';
import { verifyAdminCookie } from '@/lib/admin-auth';

export async function GET() { return POST(); }

export async function POST() {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const sql = await getDbAsync();

    await sql`
      ALTER TABLE public.marketing_automation_execution_logs
        ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false
    `;
    await sql`
      ALTER TABLE public.marketing_automation_execution_logs
        ADD COLUMN IF NOT EXISTS test_recipient text
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS mael_is_test_idx
        ON public.marketing_automation_execution_logs (automation_id, executed_at DESC)
        WHERE is_test = true
    `;

    await sql`SELECT pg_notify('pgrst', 'reload schema')`;

    return NextResponse.json({
      success: true,
      message: 'Migration 088 applied — execution logs now record test sends (is_test + test_recipient).',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[migration-088]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
