import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { getSessionUser } from '@/lib/session';
import { conversationReaderRef } from '@/lib/conversation-reader';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { threadId } = await params;

  const { data: thread, error: tErr } = await supabaseAdmin
    .from('conversation_threads')
    .select('id')
    .eq('id', threadId)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
  if (!thread) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const readerRef = conversationReaderRef(user);
  const { error } = await supabaseAdmin.from('conversation_thread_reads').upsert(
    {
      thread_id: threadId,
      reader_ref: readerRef,
      last_read_at: new Date().toISOString(),
    },
    { onConflict: 'thread_id,reader_ref' },
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** DELETE — marks the thread as unread by removing the read receipt. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { threadId } = await params;

  const { data: thread } = await supabaseAdmin
    .from('conversation_threads')
    .select('id')
    .eq('id', threadId)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (!thread) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const readerRef = conversationReaderRef(user);
  const { error } = await supabaseAdmin
    .from('conversation_thread_reads')
    .delete()
    .eq('thread_id', threadId)
    .eq('reader_ref', readerRef);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
