import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function verifyAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  return token && token === process.env.ADMIN_SECRET;
}

/**
 * GET /api/admin/feature-requests/unread-count
 * Returns the number of venue-submitted feature requests the admin hasn't read yet.
 * Excludes admin-created requests (venue_id IS NULL) and completed ones.
 */
export async function GET() {
  if (!(await verifyAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Gracefully handle the case where admin_read_at hasn't been migrated yet.
  const { count, error } = await supabaseAdmin
    .from('feature_requests')
    .select('id', { count: 'exact', head: true })
    .not('venue_id', 'is', null)   // exclude admin-created requests
    .neq('status', 'completed')
    .is('admin_read_at', null);

  if (error) {
    // Column missing (pre-migration) — return 0 gracefully
    if (/admin_read_at/i.test(error.message)) return NextResponse.json({ count: 0 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ count: count ?? 0 });
}
