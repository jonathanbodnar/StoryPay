/**
 * POST /api/conversations/threads/[threadId]/venue-direct
 *
 * Venue-side: send a "Venue Direct" reply to the StoryVenue Concierge team
 * about the contact attached to this thread. Inserts as audience='venue_direct'
 * and hides from the bride.
 *
 * Body: { body: string }
 *
 * Pairs with /api/admin/support/venue-direct (concierge → venue) and the
 * existing /api/conversations/contacts/[contactId]/venue-direct (per-contact
 * panel). Both venue-side endpoints insert the same audience='venue_direct'
 * row on the same thread, so the concierge support inbox sees them as one
 * timeline.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { getSessionUser, type SessionUser } from '@/lib/session';
import { broadcastBrideMessageAdminOnly, broadcastVenueDirectInboxUpdate } from '@/lib/realtime/broadcast';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_CHARS = 5000;

function vdReaderRef(user: SessionUser): string {
  return user.memberId ? `vd:m:${user.memberId}` : 'vd:owner';
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = await getSessionUser();
  if (!user)    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { threadId } = await params;

  // Validate the thread belongs to the current venue
  const { data: thread, error: tErr } = await supabaseAdmin
    .from('conversation_threads')
    .select('id, venue_id, venue_customer_id')
    .eq('id', threadId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
  if (!thread) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let body: { body?: string };
  try { body = (await request.json()) as { body?: string }; } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const text = (body.body || '').trim();
  if (!text)                   return NextResponse.json({ error: 'body required' }, { status: 400 });
  if (text.length > MAX_CHARS) return NextResponse.json({ error: `Message exceeds ${MAX_CHARS} chars` }, { status: 400 });

  const sender_kind          = user.memberId ? 'team' : 'owner';
  const venue_team_member_id = user.memberId ?? null;
  const t = thread as { venue_id: string; venue_customer_id: string };

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from('conversation_messages')
    .insert({
      thread_id:               threadId,
      visibility:              'internal',
      channel:                 'email',
      body:                    text,
      sender_kind,
      venue_team_member_id,
      sent_on_behalf_of_venue: false,
      support_only:            false,
      audience:                'venue_direct',
      external_email_sent:     false,
    })
    .select('id, created_at')
    .single();

  if (insErr) {
    console.error('[venue-direct/thread] insert', insErr);
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }
  const msg = inserted as { id: string; created_at: string };

  // The act of sending = "I read this thread". Mark venue_direct read for
  // this viewer so the bell badge clears.
  await supabaseAdmin.from('conversation_thread_reads').upsert(
    {
      thread_id:    threadId,
      reader_ref:   vdReaderRef(user),
      last_read_at: new Date().toISOString(),
    },
    { onConflict: 'thread_id,reader_ref' },
  );

  // Realtime → support inbox sees the reply live
  void broadcastBrideMessageAdminOnly({
    inbound:                 false,
    threadId,
    venueId,
    venueCustomerId:         t.venue_customer_id,
    messageId:               msg.id,
    body:                    text,
    channel:                 'email',
    senderKind:              sender_kind,
    sentByVenueSupport:      false,
    supportAgentId:          null,
    createdAt:               msg.created_at,
    supportOnly:             false,
    mentionedSupportUserIds: [],
  });
  // Notify VenueDirectInboxView so it refreshes instantly (replaces 30s poll).
  void broadcastVenueDirectInboxUpdate({ threadId, venueId, direction: 'inbound' });

  return NextResponse.json({ ok: true, messageId: msg.id });
}
