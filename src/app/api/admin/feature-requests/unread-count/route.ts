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

  // This is a non-critical sidebar badge. It must NEVER return a 500 — a
  // transient failure (e.g. a PostgREST schema-cache reload after a migration)
  // can return an error object with an empty message, which previously fell
  // through to a 500 with {"error":""} and broke the admin badge fetch. On any
  // failure we log the real detail server-side and degrade gracefully to 0.
  try {
    const { count, error } = await supabaseAdmin
      .from('feature_requests')
      .select('id', { count: 'exact', head: true })
      .not('venue_id', 'is', null)   // exclude admin-created requests
      .neq('status', 'completed')
      .is('admin_read_at', null);

    if (error) {
      console.warn('[feature-requests/unread-count] query error (degrading to 0):', error.message || error);
      return NextResponse.json({ count: 0 });
    }

    return NextResponse.json({ count: count ?? 0 });
  } catch (err) {
    console.error('[feature-requests/unread-count] unexpected error (degrading to 0):', err);
    return NextResponse.json({ count: 0 });
  }
}
