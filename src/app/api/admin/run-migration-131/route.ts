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

  // Step 1: add is_demo column
  const { error: e1 } = await supabaseAdmin.rpc('exec_sql' as never, {
    sql: `ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;`,
  } as never);
  if (e1) return NextResponse.json({ error: e1.message, step: 'add is_demo' }, { status: 500 });
  steps.push('is_demo column added');

  // Step 2: add demo_preview_token column
  const { error: e2 } = await supabaseAdmin.rpc('exec_sql' as never, {
    sql: `ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS demo_preview_token TEXT;`,
  } as never);
  if (e2) return NextResponse.json({ error: e2.message, step: 'add demo_preview_token' }, { status: 500 });
  steps.push('demo_preview_token column added');

  // Step 3: mark storyvenue slug as demo and generate token
  const { error: e3 } = await supabaseAdmin.rpc('exec_sql' as never, {
    sql: `
      UPDATE public.venues
      SET
        is_demo            = true,
        demo_preview_token = 'sv_demo_' || encode(gen_random_bytes(18), 'hex')
      WHERE slug = 'storyvenue'
        AND (demo_preview_token IS NULL OR demo_preview_token = '');
    `,
  } as never);
  if (e3) return NextResponse.json({ error: e3.message, step: 'mark demo venue' }, { status: 500 });
  steps.push('storyvenue venue marked as demo with preview token');

  // Fetch and return the generated token so you can copy it
  const { data: row } = await supabaseAdmin
    .from('venues')
    .select('demo_preview_token')
    .eq('slug', 'storyvenue')
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    steps,
    preview_token: (row as { demo_preview_token?: string } | null)?.demo_preview_token ?? null,
    note: 'Share demo URLs as: storyvenue.com/venue/storyvenue?preview=<token>',
  });
}
