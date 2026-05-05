/**
 * POST /api/dashboard/canned-replies/[id]/render
 *
 * Resolves a venue-scoped canned reply against a thread the venue owns.
 * Body: { threadId: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getVenueId } from '@/lib/auth-helpers';
import { supabaseAdmin } from '@/lib/supabase';
import { renderCannedReply } from '@/lib/support/canned-replies';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  let payload: { threadId?: string };
  try { payload = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const threadId = (payload.threadId || '').trim();
  if (!threadId) return NextResponse.json({ error: 'threadId required' }, { status: 400 });

  // Ownership check on the thread
  const { data: th } = await supabaseAdmin
    .from('conversation_threads')
    .select('id, venue_id')
    .eq('id', threadId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!th) return NextResponse.json({ error: 'Thread not found' }, { status: 404 });

  // Template must be visible to venues
  const { data: tpl } = await supabaseAdmin
    .from('support_canned_replies')
    .select('id, body, scope, use_count')
    .eq('id', id)
    .in('scope', ['venue', 'both'])
    .maybeSingle();
  if (!tpl) return NextResponse.json({ error: 'Template not found' }, { status: 404 });

  const t = tpl as { id: string; body: string; use_count: number };

  const result = await renderCannedReply(t.body, { threadId });

  void supabaseAdmin
    .from('support_canned_replies')
    .update({ use_count: (t.use_count ?? 0) + 1 })
    .eq('id', id);

  return NextResponse.json({ body: result.body, unknown: result.unknown });
}
