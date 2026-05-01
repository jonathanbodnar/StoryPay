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

    // Drop the old check constraint and re-add it including 'notify_owner'.
    await sql`
      ALTER TABLE public.marketing_automation_steps
        DROP CONSTRAINT IF EXISTS marketing_automation_steps_type_chk
    `;

    await sql`
      ALTER TABLE public.marketing_automation_steps
        ADD CONSTRAINT marketing_automation_steps_type_chk CHECK (
          step_type IN (
            'delay',
            'send_email',
            'send_sms',
            'add_tag',
            'remove_tag',
            'change_stage',
            'create_conversation',
            'notify_owner'
          )
        )
    `;

    await sql`SELECT pg_notify('pgrst', 'reload schema')`;

    return NextResponse.json({
      success: true,
      message: 'Migration 087 applied — marketing_automation_steps now allows notify_owner step type',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[migration-087]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
