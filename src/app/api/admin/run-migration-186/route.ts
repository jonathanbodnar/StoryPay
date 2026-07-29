import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyMasterAdminOnly } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!(await verifyMasterAdminOnly())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sql = `
    CREATE TABLE IF NOT EXISTS public.device_tokens (
      id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      venue_id       uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
      member_id      uuid REFERENCES public.venue_team_members(id) ON DELETE CASCADE,
      token          text NOT NULL UNIQUE,
      platform       text NOT NULL CHECK (platform IN ('ios', 'android')),
      created_at     timestamptz NOT NULL DEFAULT now(),
      updated_at     timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS device_tokens_venue_id_idx
      ON public.device_tokens (venue_id);

    CREATE INDEX IF NOT EXISTS device_tokens_member_id_idx
      ON public.device_tokens (member_id)
      WHERE member_id IS NOT NULL;

    ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;

    REVOKE ALL ON public.device_tokens FROM anon, authenticated;
    GRANT  ALL ON public.device_tokens TO service_role;

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

  return NextResponse.json({ ok: true, message: 'Migration 186 (device_tokens) applied successfully.' });
}
