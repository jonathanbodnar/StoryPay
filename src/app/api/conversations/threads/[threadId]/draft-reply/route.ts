/**
 * POST /api/conversations/threads/[threadId]/draft-reply
 *
 * Returns an AI-drafted reply for the venue user to review/edit before
 * sending. Uses cookie-based venue auth.
 *
 * Body: { channel?: 'sms' | 'email'; intent?: string }
 *  - channel defaults to the thread's external_reply_channel
 */
import { NextRequest, NextResponse } from 'next/server';
import { getVenueId } from '@/lib/auth-helpers';
import { supabaseAdmin } from '@/lib/supabase';
import { draftBrideReply } from '@/lib/support/draft-reply';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { threadId } = await params;

  let body: { channel?: 'sms' | 'email'; intent?: string } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  // Verify the thread belongs to this venue and resolve channel default
  const { data: t } = await supabaseAdmin
    .from('conversation_threads')
    .select('id, venue_id, external_reply_channel')
    .eq('id', threadId)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (!t) return NextResponse.json({ error: 'Thread not found' }, { status: 404 });

  const defaultChannel = (t as { external_reply_channel: string | null }).external_reply_channel === 'email' ? 'email' : 'sms';
  const channel = body.channel === 'email' ? 'email' : body.channel === 'sms' ? 'sms' : defaultChannel as 'sms' | 'email';

  const result = await draftBrideReply({
    venueId,
    threadId,
    channel,
    intent: body.intent,
    voice:  'venue',
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ text: result.text });
}
