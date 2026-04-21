import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Toggle conversation_threads.is_starred / is_pinned (works even with zero messages).
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
    .select('id, is_starred, is_pinned')
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

  const field = (body.field === 'is_pinned' ? 'is_pinned' : 'is_starred') as 'is_starred' | 'is_pinned';

  const row = thread as { is_starred?: boolean; is_pinned?: boolean };
  const current = field === 'is_pinned' ? !!row.is_pinned : !!row.is_starred;
  const next = !current;

  const { error: uErr } = await supabaseAdmin
    .from('conversation_threads')
    .update({ [field]: next, updated_at: new Date().toISOString() })
    .eq('id', threadId)
    .eq('venue_id', venueId);

  if (uErr) {
    if (uErr.message?.includes('is_starred') || uErr.message?.includes('is_pinned')) {
      return NextResponse.json(
        {
          error:
            'Database migration required: run migrations/044_conversation_threads_star_pin.sql',
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: uErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, [field]: next });
}
