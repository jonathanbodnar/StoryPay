import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { threadId } = await params;

  const { data: thread, error } = await supabaseAdmin
    .from('conversation_threads')
    .select('id, subject, last_message_at, venue_customer_id, external_reply_channel')
    .eq('id', threadId)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!thread) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: contact } = await supabaseAdmin
    .from('venue_customers')
    .select(
      'id, first_name, last_name, customer_email, phone, sms_dnd, conversation_dnd_all, conversation_dnd_email, conversation_dnd_calls, conversation_dnd_inbound_sms',
    )
    .eq('id', thread.venue_customer_id)
    .eq('venue_id', venueId)
    .maybeSingle();

  return NextResponse.json({
    ...thread,
    venue_customers: contact ?? null,
  });
}
