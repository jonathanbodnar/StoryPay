/**
 * GET /api/conversations/contacts/[contactId]/thread
 *
 * Resolve-or-create the contact's conversation thread by venue_customer id
 * (robust for SMS-only contacts that have no email). Used by the Conversations
 * tab inside a contact profile so it shows the exact same thread as the
 * Conversations page. Returns the most-recent thread for the contact, creating
 * one if none exists yet.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { conversationHttpError } from '@/lib/conversation-db-errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ contactId: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { contactId } = await params;
  if (!contactId) return NextResponse.json({ error: 'Missing contact id' }, { status: 400 });

  // Ensure the contact belongs to this venue.
  const { data: vc, error: vcErr } = await supabaseAdmin
    .from('venue_customers')
    .select('id')
    .eq('venue_id', venueId)
    .eq('id', contactId)
    .maybeSingle();
  if (vcErr) {
    const { status, body } = conversationHttpError(vcErr);
    return NextResponse.json(body, { status });
  }
  if (!vc) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });

  const { data: existing, error: listErr } = await supabaseAdmin
    .from('conversation_threads')
    .select('id, external_reply_channel')
    .eq('venue_id', venueId)
    .eq('venue_customer_id', contactId)
    .order('last_message_at', { ascending: false })
    .limit(1);
  if (listErr) {
    const { status, body } = conversationHttpError(listErr);
    return NextResponse.json(body, { status });
  }

  const found = existing?.[0] as { id: string; external_reply_channel?: string } | undefined;
  if (found) {
    return NextResponse.json({
      thread_id: found.id,
      external_reply_channel: found.external_reply_channel ?? 'email',
    });
  }

  const { data: thread, error: insErr } = await supabaseAdmin
    .from('conversation_threads')
    .insert({ venue_id: venueId, venue_customer_id: contactId, subject: 'Conversation' })
    .select('id, external_reply_channel')
    .single();
  if (insErr || !thread) {
    const { status, body } = conversationHttpError(insErr);
    return NextResponse.json(body, { status });
  }

  return NextResponse.json({
    thread_id: thread.id,
    external_reply_channel: (thread as { external_reply_channel?: string }).external_reply_channel ?? 'email',
  });
}
