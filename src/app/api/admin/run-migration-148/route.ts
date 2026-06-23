import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyMasterAdminOnly } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!(await verifyMasterAdminOnly())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sql = `
    ALTER TABLE public.venues
      ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS onboarding_last_step    SMALLINT DEFAULT 0;

    CREATE INDEX IF NOT EXISTS venues_onboarding_incomplete_idx
      ON public.venues (onboarding_last_step)
      WHERE onboarding_completed_at IS NULL;

    NOTIFY pgrst, 'reload schema';
  `;

  const { error } = await supabaseAdmin.rpc('exec_sql', { sql_query: sql });

  if (error) {
    if (error.code === 'PGRST202') {
      return NextResponse.json(
        { error: 'Please apply this SQL manually in the Supabase dashboard:', sql },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, message: 'Migration 148 applied successfully.' });
}
