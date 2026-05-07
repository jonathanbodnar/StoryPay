/**
 * POST /api/conversations/threads/[threadId]/venue-direct/mark-read
 *
 * Marks all venue_direct messages on this thread as read for the current
 * viewer (owner or team member). Updates conversation_thread_reads with
 * reader_ref prefixed `vd:` so it's independent from bride-conversation
 * read state.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { getSessionUser, type SessionUser } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function vdReaderRef(user: SessionUser): string {
  return user.memberId ? `vd:m:${user.memberId}` : 'vd:owner';
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = await getSessionUser();
  if (!user)    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { threadId } = await params;

  // Validate the thread belongs to the current venue
  const { data: thread } = await supabaseAdmin
    .from('conversation_threads')
    .select('id, venue_id')
    .eq('id', threadId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!thread) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await supabaseAdmin.from('conversation_thread_reads').upsert(
    {
      thread_id:    threadId,
      reader_ref:   vdReaderRef(user),
      last_read_at: new Date().toISOString(),
    },
    { onConflict: 'thread_id,reader_ref' },
  );

  return NextResponse.json({ ok: true });
}
