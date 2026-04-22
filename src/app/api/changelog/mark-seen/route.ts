import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * Marks all currently published changelog entries as read for the current
 * venue. Idempotent — every call just stamps updates_last_seen_at = now().
 */
export async function POST() {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const nowIso = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from('venues')
    .update({ updates_last_seen_at: nowIso })
    .eq('id', venueId);

  if (error) {
    // Pre-migration DBs will not have the column yet; surface a 200 so the
    // UI does not break, but log so the operator can apply migration 048.
    if (/column .*updates_last_seen_at/i.test(error.message)) {
      console.warn('[changelog/mark-seen] migration 048 not applied yet:', error.message);
      return NextResponse.json({ ok: true, pending_migration: true });
    }
    console.error('[changelog/mark-seen] update error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, last_seen_at: nowIso });
}
