/**
 * GET /api/admin/venue-concierge/threads
 *
 * One row per venue that has a general Venue Concierge conversation, ordered by
 * most-recent activity, with latest-message preview + unread count for the
 * concierge side.
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifySupportAccess } from '@/lib/support/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface MsgRow {
  id: string;
  venue_id: string;
  sender_kind: 'venue' | 'concierge';
  body: string;
  created_at: string;
}

export async function GET() {
  const { isSuperAdmin, agent } = await verifySupportAccess();
  if (!isSuperAdmin && !agent) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: rows } = await supabaseAdmin
    .from('venue_concierge_messages')
    .select('id, venue_id, sender_kind, body, created_at')
    .order('created_at', { ascending: false });
  const msgs = ((rows ?? []) as unknown) as MsgRow[];
  if (msgs.length === 0) return NextResponse.json({ threads: [] });

  // Group by venue → latest message + count venue-authored messages.
  const byVenue = new Map<string, { latest: MsgRow; venueMsgs: MsgRow[] }>();
  for (const m of msgs) {
    const cur = byVenue.get(m.venue_id);
    if (cur) {
      if (m.sender_kind === 'venue') cur.venueMsgs.push(m);
    } else {
      byVenue.set(m.venue_id, {
        latest: m,
        venueMsgs: m.sender_kind === 'venue' ? [m] : [],
      });
    }
  }

  const venueIds = Array.from(byVenue.keys());
  const { data: venues } = await supabaseAdmin
    .from('venues')
    .select('id, name')
    .in('id', venueIds);
  const venueName: Record<string, string> = {};
  for (const v of (venues ?? []) as Array<{ id: string; name: string | null }>) {
    venueName[v.id] = v.name || 'Venue';
  }

  // Concierge-side read cursors.
  const { data: reads } = await supabaseAdmin
    .from('venue_concierge_reads')
    .select('venue_id, last_read_at, reader_ref')
    .eq('reader_ref', 'concierge')
    .in('venue_id', venueIds);
  const lastReadAt: Record<string, string> = {};
  for (const r of (reads ?? []) as Array<{ venue_id: string; last_read_at: string }>) {
    lastReadAt[r.venue_id] = r.last_read_at;
  }

  const threads = Array.from(byVenue.entries()).map(([venueId, group]) => {
    const lastRead = lastReadAt[venueId];
    const unread = group.venueMsgs.filter(
      (m) => !lastRead || new Date(m.created_at) > new Date(lastRead),
    ).length;
    return {
      venueId,
      venueName: venueName[venueId] || 'Venue',
      latestBody: group.latest.body,
      latestAt: group.latest.created_at,
      latestFromVenue: group.latest.sender_kind === 'venue',
      unreadCount: unread,
    };
  }).sort((a, b) => +new Date(b.latestAt) - +new Date(a.latestAt));

  return NextResponse.json({ threads });
}
