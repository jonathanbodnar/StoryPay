/**
 * GET /api/conversations/venue-direct/unread-count
 *
 * Returns the total number of venue_direct messages on this venue's threads
 * that the current viewer (owner or team member) has NOT read yet. Used to
 * power the bell-icon badge in the dashboard sidebar.
 *
 * "Read" state is tracked in conversation_thread_reads with reader_ref
 * prefixed `vd:` so it's independent from the bride-conversation read state
 * on the same thread.
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { getSessionUser } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function vdReaderRef(memberId: string | null | undefined): string {
  return memberId ? `vd:m:${memberId}` : 'vd:owner';
}

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ count: 0 });
  const user = await getSessionUser();
  if (!user)    return NextResponse.json({ count: 0 });

  // 1. All venue_direct messages on threads belonging to this venue
  const { data: msgs } = await supabaseAdmin
    .from('conversation_messages')
    .select('thread_id, sender_kind, created_at, conversation_threads!inner(venue_id)')
    .eq('audience', 'venue_direct')
    .eq('conversation_threads.venue_id', venueId);

  type Row = { thread_id: string; sender_kind: string; created_at: string };
  const all = (msgs ?? []) as Row[];

  // We only count messages FROM the concierge (sender_kind='concierge') as
  // "unread for venue". Messages the venue itself sent are inherently read.
  const conciergeMsgs = all.filter(m => m.sender_kind === 'concierge');
  if (conciergeMsgs.length === 0) return NextResponse.json({ count: 0 });

  // 2. Reads for this viewer, prefixed `vd:`
  const ref = vdReaderRef(user.memberId);
  const threadIds = Array.from(new Set(conciergeMsgs.map(m => m.thread_id)));
  const { data: reads } = await supabaseAdmin
    .from('conversation_thread_reads')
    .select('thread_id, last_read_at')
    .eq('reader_ref', ref)
    .in('thread_id', threadIds);
  const lastReadAt: Record<string, string> = {};
  for (const r of (reads ?? []) as Array<{ thread_id: string; last_read_at: string }>) {
    lastReadAt[r.thread_id] = r.last_read_at;
  }

  let count = 0;
  for (const m of conciergeMsgs) {
    const last = lastReadAt[m.thread_id];
    if (!last || new Date(m.created_at) > new Date(last)) count += 1;
  }
  return NextResponse.json({ count });
}
