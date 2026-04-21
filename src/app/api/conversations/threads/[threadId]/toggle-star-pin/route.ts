import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Toggle thread highlight: if any message in the thread has the flag, clear it on all
 * messages; otherwise set the flag on the latest message only.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { threadId } = await params;
  const { data: thread, error: tErr } = await supabaseAdmin
    .from('conversation_threads')
    .select('id')
    .eq('id', threadId)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
  if (!thread) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let body: { field?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const field = body.field === 'is_pinned' ? 'is_pinned' : 'is_starred';

  const { data: msgs, error: mErr } = await supabaseAdmin
    .from('conversation_messages')
    .select('id, created_at, is_starred, is_pinned')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: false });

  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });

  const list = msgs ?? [];
  const anyOn = list.some((m) => Boolean(m[field as 'is_starred' | 'is_pinned']));

  if (anyOn) {
    const { error: uErr } = await supabaseAdmin
      .from('conversation_messages')
      .update({ [field]: false })
      .eq('thread_id', threadId);
    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });
  } else {
    const latest = list[0];
    if (!latest) return NextResponse.json({ error: 'No messages in thread' }, { status: 400 });
    const { error: uErr } = await supabaseAdmin
      .from('conversation_messages')
      .update({ [field]: true })
      .eq('id', latest.id);
    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
