import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * Returns how many changelog entries have been released since this venue
 * last visited the What's New page. The sidebar uses the count to render a
 * red dot + badge; it's cleared by POST /api/changelog/mark-seen.
 */
export async function GET() {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let lastSeen: string | null = null;
  try {
    const { data: venue } = await supabaseAdmin
      .from('venues')
      .select('updates_last_seen_at')
      .eq('id', venueId)
      .maybeSingle();
    lastSeen = (venue?.updates_last_seen_at as string | null) ?? null;
  } catch (err) {
    console.warn('[changelog/unread-count] missing venues.updates_last_seen_at column', err);
  }

  let query = supabaseAdmin
    .from('changelog_entries')
    .select('id', { head: true, count: 'exact' });
  if (lastSeen) query = query.gt('released_at', lastSeen);

  const { count, error } = await query;
  if (error) {
    console.error('[changelog/unread-count] count error:', error.message);
    return NextResponse.json({ count: 0, last_seen_at: lastSeen });
  }
  return NextResponse.json({ count: count ?? 0, last_seen_at: lastSeen });
}
