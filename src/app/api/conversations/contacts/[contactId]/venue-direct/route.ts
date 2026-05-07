/**
 * GET  /api/conversations/contacts/[contactId]/venue-direct
 * POST /api/conversations/contacts/[contactId]/venue-direct
 *
 * Per-contact "Venue Direct" thread between the StoryVenue concierge team
 * and this venue's staff. Lives on top of the contact's most-recent
 * conversation_thread but only surfaces messages with audience='venue_direct'
 * (or audience='external' AND sender_kind='concierge' for legacy fallback).
 *
 * GET  → returns the venue_direct messages, oldest-first.
 * POST → venue replies back to the concierge.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { getSessionUser, type SessionUser } from '@/lib/session';
import { broadcastBrideMessageAdminOnly } from '@/lib/realtime/broadcast';

/** Reader ref for venue_direct read-state. Prefixed `vd:` so it's independent
 *  from bride-conversation read state on the same thread. */
function vdReaderRef(user: SessionUser): string {
  return user.memberId ? `vd:m:${user.memberId}` : 'vd:owner';
}

async function markThreadReadForViewer(threadId: string, user: SessionUser): Promise<void> {
  await supabaseAdmin
    .from('conversation_thread_reads')
    .upsert(
      {
        thread_id:    threadId,
        reader_ref:   vdReaderRef(user),
        last_read_at: new Date().toISOString(),
      },
      { onConflict: 'thread_id,reader_ref' },
    );
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_CHARS = 5000;

interface ThreadRow {
  id:                string;
  venue_id:          string;
  venue_customer_id: string;
  updated_at:        string | null;
  created_at:        string;
}

interface MessageRow {
  id:                      string;
  thread_id:               string;
  body:                    string;
  sender_kind:             string;
  audience:                string | null;
  sent_by_support_user_id: string | null;
  venue_team_member_id:    string | null;
  created_at:              string;
}

async function resolveThreadId(contactId: string, venueId: string): Promise<{ ok: true; thread: ThreadRow } | { ok: false; error: string; status: number }> {
  // Most-recent thread for this contact within the venue
  const { data, error } = await supabaseAdmin
    .from('conversation_threads')
    .select('id, venue_id, venue_customer_id, updated_at, created_at')
    .eq('venue_id', venueId)
    .eq('venue_customer_id', contactId)
    .order('updated_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, error: error.message, status: 500 };
  if (!data)  return { ok: false, error: 'No conversation thread for this contact yet', status: 404 };
  return { ok: true, thread: data as ThreadRow };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ contactId: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = await getSessionUser();
  if (!user)    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { contactId } = await params;
  const t = await resolveThreadId(contactId, venueId);
  if (!t.ok) {
    // No thread yet → nothing to show. Return empty list with 200 so the UI
    // doesn't error on first paint.
    if (t.status === 404) return NextResponse.json({ messages: [], threadId: null });
    return NextResponse.json({ error: t.error }, { status: t.status });
  }

  // Opening the panel = "I read these". Mark all venue_direct messages on
  // this thread as read for the current viewer so the bell-badge clears.
  await markThreadReadForViewer(t.thread.id, user);

  const { data: msgs, error } = await supabaseAdmin
    .from('conversation_messages')
    .select('id, thread_id, body, sender_kind, audience, sent_by_support_user_id, venue_team_member_id, created_at')
    .eq('thread_id', t.thread.id)
    .eq('audience', 'venue_direct')
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Resolve display names so the UI can label each message.
  const supportIds = Array.from(new Set(((msgs ?? []) as MessageRow[])
    .map(m => m.sent_by_support_user_id).filter(Boolean) as string[]));
  const memberIds  = Array.from(new Set(((msgs ?? []) as MessageRow[])
    .map(m => m.venue_team_member_id).filter(Boolean) as string[]));

  const supportNames: Record<string, string> = {};
  if (supportIds.length > 0) {
    const { data } = await supabaseAdmin
      .from('support_team_members')
      .select('id, name')
      .in('id', supportIds);
    for (const r of (data ?? []) as Array<{ id: string; name: string | null }>) {
      supportNames[r.id] = r.name || 'StoryVenue Support';
    }
  }

  const memberNames: Record<string, string> = {};
  if (memberIds.length > 0) {
    const { data } = await supabaseAdmin
      .from('venue_team_members')
      .select('id, name, first_name, last_name')
      .eq('venue_id', venueId)
      .in('id', memberIds);
    for (const r of (data ?? []) as Array<{ id: string; name: string | null; first_name: string | null; last_name: string | null }>) {
      memberNames[r.id] = [r.first_name, r.last_name].filter(Boolean).join(' ') || r.name || 'Team member';
    }
  }

  const enriched = ((msgs ?? []) as MessageRow[]).map(m => ({
    ...m,
    author_label:
      m.sender_kind === 'concierge'
        ? (m.sent_by_support_user_id && supportNames[m.sent_by_support_user_id]
            ? `StoryVenue Support — ${supportNames[m.sent_by_support_user_id]}`
            : 'StoryVenue Support')
        : (m.venue_team_member_id && memberNames[m.venue_team_member_id]) || 'Venue team',
  }));

  return NextResponse.json({ messages: enriched, threadId: t.thread.id, venueId });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ contactId: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = await getSessionUser();
  if (!user)    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { contactId } = await params;
  const t = await resolveThreadId(contactId, venueId);
  if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.status });

  let body: { body?: string };
  try { body = (await request.json()) as { body?: string }; } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const text = (body.body || '').trim();
  if (!text)                    return NextResponse.json({ error: 'body required' }, { status: 400 });
  if (text.length > MAX_CHARS)  return NextResponse.json({ error: `Message exceeds ${MAX_CHARS} chars` }, { status: 400 });

  const sender_kind         = user.memberId ? 'team' : 'owner';
  const venue_team_member_id = user.memberId ?? null;

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from('conversation_messages')
    .insert({
      thread_id:               t.thread.id,
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
    console.error('[venue-direct/venue] insert', insErr);
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  // The act of replying is itself "reading", so mark the thread read for
  // this viewer too. This also ensures their own outbound message doesn't
  // look like an unread message back to them on next load.
  await markThreadReadForViewer(t.thread.id, user);

  // Realtime fan-out so the concierge support inbox sees the reply live.
  void broadcastBrideMessageAdminOnly({
    inbound:                 false,
    threadId:                t.thread.id,
    venueId,
    venueCustomerId:         contactId,
    messageId:               (inserted as { id: string }).id,
    body:                    text,
    channel:                 'email',
    senderKind:              sender_kind,
    sentByVenueSupport:      false,
    supportAgentId:          null,
    createdAt:               (inserted as { created_at?: string }).created_at || new Date().toISOString(),
    supportOnly:             false,
    mentionedSupportUserIds: [],
  });

  return NextResponse.json({
    ok: true,
    messageId: (inserted as { id: string }).id,
    threadId:  t.thread.id,
  });
}
