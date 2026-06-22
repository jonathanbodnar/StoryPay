import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyMasterAdminOnly } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!(await verifyMasterAdminOnly())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sql = `
    ALTER TABLE public.venue_media_assets
      DROP CONSTRAINT IF EXISTS venue_media_assets_size_chk;

    ALTER TABLE public.venue_media_assets
      ADD CONSTRAINT venue_media_assets_size_chk
      CHECK (size_bytes > 0 AND size_bytes <= 52428800);
  `;

  const { error } = await supabaseAdmin.rpc('exec_sql', { sql_query: sql });

  if (error) {
    if (error.code === 'PGRST202') {
       return NextResponse.json({ error: 'Please apply this SQL manually in the Supabase dashboard:', sql }, { status: 500 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Also update the bucket config
  const { error: updErr } = await supabaseAdmin.storage.updateBucket('venue-images', {
    public: true,
    fileSizeLimit: 52428800,
  });

  if (updErr) {
    console.warn('[migration 147] updateBucket warning:', updErr.message);
  }

  return NextResponse.json({ ok: true, message: 'Migration 147 applied successfully. Max file size is now 50MB.' });
}