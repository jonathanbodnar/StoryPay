/**
 * POST /api/admin/support/draft-bride-reply
 *
 * Returns an AI-drafted reply for the support agent to send (as the venue) to
 * a bride. Reusing the same context the inbox already has.
 *
 * Body: { threadId: string; channel: 'sms' | 'email'; intent?: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifySupportAccess } from '@/lib/support/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { draftBrideReply } from '@/lib/support/draft-reply';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const auth = await verifySupportAccess();
  if (!auth.isSuperAdmin && !auth.agent) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { threadId?: string; channel?: 'sms' | 'email'; intent?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const threadId = (body.threadId || '').trim();
  const channel  = body.channel === 'email' ? 'email' : 'sms';
  if (!threadId) return NextResponse.json({ error: 'threadId required' }, { status: 400 });

  // Resolve venueId from the thread (super admin can draft for any venue).
  const { data: t } = await supabaseAdmin
    .from('conversation_threads')
    .select('venue_id')
    .eq('id', threadId)
    .maybeSingle();

  if (!t) return NextResponse.json({ error: 'Thread not found' }, { status: 404 });

  const result = await draftBrideReply({
    venueId:  (t as { venue_id: string }).venue_id,
    threadId,
    channel,
    intent:   body.intent,
    voice:    'venue',
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json({ text: result.text });
}
