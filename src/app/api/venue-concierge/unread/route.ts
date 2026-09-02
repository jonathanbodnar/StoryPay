/**
 * GET /api/venue-concierge/unread
 *
 * Count of concierge-authored messages newer than the venue's read cursor.
 * Powers the sidebar badge on the Venue Concierge menu item.
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSessionUser } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const VENUE_READER_REF = 'venue';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ count: 0 });

  const { data: readRow } = await supabaseAdmin
    .from('venue_concierge_reads')
    .select('last_read_at')
    .eq('venue_id', user.venueId)
    .eq('reader_ref', VENUE_READER_REF)
    .maybeSingle();
  const lastReadAt = (readRow as { last_read_at?: string } | null)?.last_read_at ?? null;

  let q = supabaseAdmin
    .from('venue_concierge_messages')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', user.venueId)
    .eq('sender_kind', 'concierge');
  if (lastReadAt) q = q.gt('created_at', lastReadAt);

  const { count } = await q;
  return NextResponse.json({ count: count ?? 0 });
}
