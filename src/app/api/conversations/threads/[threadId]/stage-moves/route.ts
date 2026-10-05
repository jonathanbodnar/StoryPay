/**
 * GET /api/conversations/threads/[threadId]/stage-moves
 *
 * Every move of this thread's bride to another pipeline stage: when, to which
 * stage, and who moved her. The venue's conversation shows them as one-line
 * entries between the messages (lib/lead-stage-log.ts). They are not
 * messages, and the couple never sees them.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { loadStageMovesForCustomer } from '@/lib/lead-stage-log';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ threadId: string }> }) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { threadId } = await params;
  const { data: thread } = await supabaseAdmin
    .from('conversation_threads')
    .select('venue_customer_id')
    .eq('id', threadId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!thread) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const moves = await loadStageMovesForCustomer(venueId, (thread as { venue_customer_id: string }).venue_customer_id);
  return NextResponse.json({ moves });
}
