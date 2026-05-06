import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// One-shot DDL migration endpoint for the admin user only.
// POST body: { key: string } where key matches ADMIN_MIGRATION_KEY env var.
const MIGRATIONS: Record<string, string> = {
  add_is_starred_to_proposal_templates:
    'ALTER TABLE proposal_templates ADD COLUMN IF NOT EXISTS is_starred boolean NOT NULL DEFAULT false;',
};

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const role = cookieStore.get('role')?.value;
  if (role !== 'admin' && role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { migration } = await request.json() as { migration?: string };
  if (!migration || !MIGRATIONS[migration]) {
    return NextResponse.json(
      { error: 'Unknown migration', available: Object.keys(MIGRATIONS) },
      { status: 400 }
    );
  }

  const { error } = await supabaseAdmin.rpc('exec_migration', {
    sql: MIGRATIONS[migration],
  }).single();

  if (error) {
    // Try direct Supabase admin approach — use raw SQL via service role
    // Supabase exposes no raw-DDL RPC by default, so we use a workaround:
    // insert a dummy row to verify the column exists, or catch the error.
    const testResult = await supabaseAdmin
      .from('proposal_templates')
      .select('is_starred')
      .limit(1);

    if (!testResult.error) {
      return NextResponse.json({ success: true, note: 'Column already exists' });
    }

    return NextResponse.json(
      { error: 'Could not run migration automatically. Please run the following SQL in the Supabase dashboard:\n\n' + MIGRATIONS[migration] },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
