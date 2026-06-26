import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyMasterAdminOnly } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!(await verifyMasterAdminOnly())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sql = `
    CREATE SEQUENCE IF NOT EXISTS public.proposal_number_seq START 1001;

    ALTER TABLE public.proposals ADD COLUMN IF NOT EXISTS proposal_number bigint;
    ALTER TABLE public.proposals ALTER COLUMN proposal_number SET DEFAULT nextval('public.proposal_number_seq');

    DO $$
    DECLARE r record;
    BEGIN
      FOR r IN SELECT id FROM public.proposals WHERE proposal_number IS NULL ORDER BY created_at LOOP
        UPDATE public.proposals SET proposal_number = nextval('public.proposal_number_seq') WHERE id = r.id;
      END LOOP;
    END $$;

    ALTER TABLE public.venue_packages
      ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES public.proposal_templates(id) ON DELETE SET NULL;

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

  return NextResponse.json({ ok: true, message: 'Migration 156 applied successfully.' });
}
