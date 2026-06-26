import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyMasterAdminOnly } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!(await verifyMasterAdminOnly())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sql = `
    CREATE TABLE IF NOT EXISTS public.proposal_payments (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      proposal_id  uuid NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
      venue_id     uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
      amount_cents integer NOT NULL CHECK (amount_cents > 0),
      method       text NOT NULL DEFAULT 'cash',
      check_number text,
      note         text,
      recorded_by  text,
      paid_at      timestamptz NOT NULL DEFAULT now(),
      created_at   timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_proposal_payments_proposal ON public.proposal_payments(proposal_id);
    CREATE INDEX IF NOT EXISTS idx_proposal_payments_venue ON public.proposal_payments(venue_id);

    CREATE SEQUENCE IF NOT EXISTS public.proposal_payment_number_seq START 1001;

    ALTER TABLE public.proposal_payments ADD COLUMN IF NOT EXISTS payment_number bigint;
    ALTER TABLE public.proposal_payments ALTER COLUMN payment_number SET DEFAULT nextval('public.proposal_payment_number_seq');
    UPDATE public.proposal_payments SET payment_number = nextval('public.proposal_payment_number_seq') WHERE payment_number IS NULL;

    ALTER TABLE public.proposal_payments ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
    ALTER TABLE public.proposal_payments ADD COLUMN IF NOT EXISTS reference text;

    ALTER TABLE public.proposal_payments DROP CONSTRAINT IF EXISTS proposal_payments_method_check;
    ALTER TABLE public.proposal_payments ADD CONSTRAINT proposal_payments_method_check
      CHECK (method = ANY (ARRAY['cash'::text,'check'::text,'other'::text,'cc'::text,'ach'::text]));

    CREATE UNIQUE INDEX IF NOT EXISTS uq_proposal_payments_ref
      ON public.proposal_payments(proposal_id, reference)
      WHERE reference IS NOT NULL;

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

  return NextResponse.json({ ok: true, message: 'Migration 155 applied successfully.' });
}
