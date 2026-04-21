import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string; messageId: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { threadId, messageId } = await params;
  const body = (await request.json()) as Record<string, unknown>;

  const { data: thread, error: tErr } = await supabaseAdmin
    .from('conversation_threads')
    .select('id')
    .eq('id', threadId)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
  if (!thread) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const updates: Record<string, unknown> = {};
  if (typeof body.is_starred === 'boolean') updates.is_starred = body.is_starred;
  if (typeof body.is_pinned === 'boolean') updates.is_pinned = body.is_pinned;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'is_starred or is_pinned required' }, { status: 400 });
  }

  const { data: row, error } = await supabaseAdmin
    .from('conversation_messages')
    .update(updates)
    .eq('id', messageId)
    .eq('thread_id', threadId)
    .select('*')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Message not found' }, { status: 404 });

  return NextResponse.json(row);
}
