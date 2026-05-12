import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyMasterAdminOnly } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime  = 'nodejs';

export async function POST() {
  if (!(await verifyMasterAdminOnly())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const steps: string[] = [];

  const { error: e1 } = await supabaseAdmin.rpc('exec_sql' as never, {
    sql: `ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS notification_phone text;`,
  } as never);
  if (e1) return NextResponse.json({ error: e1.message, step: 'add notification_phone' }, { status: 500 });
  steps.push('notification_phone column added to venues');

  const { error: e2 } = await supabaseAdmin.rpc('exec_sql' as never, {
    sql: `NOTIFY pgrst, 'reload schema';`,
  } as never);
  if (e2) console.warn('[migration-132] schema reload notify failed:', e2.message);
  else steps.push('PostgREST schema cache reloaded');

  return NextResponse.json({ ok: true, steps });
}
