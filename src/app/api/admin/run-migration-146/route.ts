import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyMasterAdminOnly } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!(await verifyMasterAdminOnly())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sql = `
    ALTER TABLE public.venue_pricing_guides
    ADD COLUMN IF NOT EXISTS use_custom_pricing_guide boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS custom_pricing_guide_url text;
  `;

  const { error } = await supabaseAdmin.rpc('exec_sql', { sql_query: sql });

  if (error) {
    // Fallback if exec_sql doesn't exist
    if (error.code === 'PGRST202') {
       return NextResponse.json({ error: 'Please apply this SQL manually in the Supabase dashboard:', sql }, { status: 500 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, message: 'Migration 146 applied successfully.' });
}