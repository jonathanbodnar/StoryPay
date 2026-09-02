/**
 * GET /api/admin/venue-concierge/unread-count
 *
 * Total concierge-side unread across every venue's Venue Concierge thread —
 * powers the Support Inbox "Venue Concierge" tab badge. Counts venue-authored
 * messages newer than each venue's concierge read cursor.
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifySupportAccess } from '@/lib/support/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const { isSuperAdmin, agent } = await verifySupportAccess();
  if (!isSuperAdmin && !agent) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: msgs } = await supabaseAdmin
    .from('venue_concierge_messages')
    .select('venue_id, sender_kind, created_at')
    .eq('sender_kind', 'venue');
  const rows = (msgs ?? []) as Array<{ venue_id: string; created_at: string }>;
  if (rows.length === 0) return NextResponse.json({ count: 0 });

  const venueIds = Array.from(new Set(rows.map((r) => r.venue_id)));
  const { data: reads } = await supabaseAdmin
    .from('venue_concierge_reads')
    .select('venue_id, last_read_at')
    .eq('reader_ref', 'concierge')
    .in('venue_id', venueIds);
  const lastReadAt: Record<string, string> = {};
  for (const r of (reads ?? []) as Array<{ venue_id: string; last_read_at: string }>) {
    lastReadAt[r.venue_id] = r.last_read_at;
  }

  let count = 0;
  for (const m of rows) {
    const last = lastReadAt[m.venue_id];
    if (!last || new Date(m.created_at) > new Date(last)) count += 1;
  }
  return NextResponse.json({ count });
}
