import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import {
  isMissingThreadStarPinColumnsError,
  toggleStarPinOnMessages,
} from '@/lib/conversation-thread-flags';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Toggle conversation_threads.is_starred / is_pinned when migration 044 is applied.
 * Falls back to message-level flags (migration 043) if thread columns are missing.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { threadId } = await params;

  let body: { field?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const field = (body.field === 'is_pinned' ? 'is_pinned' : 'is_starred') as 'is_starred' | 'is_pinned';

  const tryMessages = async () => {
    const r = await toggleStarPinOnMessages(threadId, field);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, mode: 'messages' as const });
  };

  const { data: thread, error: tErr } = await supabaseAdmin
    .from('conversation_threads')
    .select('id, is_starred, is_pinned')
    .eq('id', threadId)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (tErr && isMissingThreadStarPinColumnsError(tErr)) {
    return tryMessages();
  }
  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
  if (!thread) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const row = thread as { is_starred?: boolean; is_pinned?: boolean };
  const current = field === 'is_pinned' ? !!row.is_pinned : !!row.is_starred;
  const next = !current;

  const { error: uErr } = await supabaseAdmin
    .from('conversation_threads')
    .update({ [field]: next, updated_at: new Date().toISOString() })
    .eq('id', threadId)
    .eq('venue_id', venueId);

  if (uErr && isMissingThreadStarPinColumnsError(uErr)) {
    return tryMessages();
  }
  if (uErr) {
    return NextResponse.json(
      {
        error: uErr.message,
        hint: 'If this mentions is_starred/is_pinned, run migrations/044_conversation_threads_star_pin.sql',
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, mode: 'thread' as const, [field]: next });
}
