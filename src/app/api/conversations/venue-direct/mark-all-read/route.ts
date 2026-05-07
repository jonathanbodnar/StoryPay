/**
 * POST /api/conversations/venue-direct/mark-all-read
 *
 * Marks all Venue Direct threads for the current venue viewer as read.
 * Upserts a conversation_thread_reads row (vd: prefix) for every thread
 * that has venue_direct messages, so the unread count resets to 0.
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { getSessionUser, type SessionUser } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function vdReaderRef(user: SessionUser): string {
  return user.memberId ? `vd:m:${user.memberId}` : 'vd:owner';
}

export async function POST() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Find all threads with venue_direct messages for this venue
  const { data: msgs } = await supabaseAdmin
    .from('conversation_messages')
    .select('thread_id, conversation_threads!inner(venue_id)')
    .eq('audience', 'venue_direct')
    .eq('conversation_threads.venue_id', venueId);

  const threadIds = Array.from(new Set(
    ((msgs ?? []) as Array<{ thread_id: string }>).map(m => m.thread_id),
  ));

  if (threadIds.length === 0) return NextResponse.json({ ok: true, marked: 0 });

  const now = new Date().toISOString();
  const ref = vdReaderRef(user);
  const rows = threadIds.map(tid => ({
    thread_id:    tid,
    reader_ref:   ref,
    last_read_at: now,
  }));

  const { error } = await supabaseAdmin
    .from('conversation_thread_reads')
    .upsert(rows, { onConflict: 'thread_id,reader_ref' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, marked: threadIds.length });
}
