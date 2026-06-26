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
      method       text NOT NULL DEFAULT 'cash' CHECK (method = ANY (ARRAY['cash'::text,'check'::text,'other'::text])),
      check_number text,
      note         text,
      recorded_by  text,
      paid_at      timestamptz NOT NULL DEFAULT now(),
      created_at   timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_proposal_payments_proposal ON public.proposal_payments(proposal_id);
    CREATE INDEX IF NOT EXISTS idx_proposal_payments_venue ON public.proposal_payments(venue_id);

    ALTER TABLE public.proposals
      ADD COLUMN IF NOT EXISTS collect_manually boolean NOT NULL DEFAULT false;
    ALTER TABLE public.proposals
      ADD COLUMN IF NOT EXISTS require_signature boolean NOT NULL DEFAULT true;

    ALTER TABLE public.proposals DROP CONSTRAINT IF EXISTS proposals_status_check;
    ALTER TABLE public.proposals ADD CONSTRAINT proposals_status_check
      CHECK (status = ANY (ARRAY[
        'draft'::text,
        'sent'::text,
        'opened'::text,
        'signed'::text,
        'paid'::text,
        'partially_paid'::text,
        'refunded'::text,
        'partial_refund'::text,
        'expired'::text,
        'cancelled'::text,
        'declined'::text
      ]));

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

  return NextResponse.json({ ok: true, message: 'Migration 154 applied successfully.' });
}
