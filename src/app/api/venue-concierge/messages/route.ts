/**
 * Venue Concierge — general relationship channel (venue side).
 *
 * GET  /api/venue-concierge/messages  → full history for the caller's venue,
 *      with concierge author name/avatar resolved. Marks the venue-side read
 *      cursor as caught-up.
 * POST /api/venue-concierge/messages  → venue owner/team sends a message.
 *
 * One implicit thread per venue (see migration 211).
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSessionUser } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const VENUE_READER_REF = 'venue';

interface MsgRow {
  id: string;
  venue_id: string;
  sender_kind: 'venue' | 'concierge';
  sender_support_user_id: string | null;
  sender_label: string | null;
  body: string;
  created_at: string;
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: rows } = await supabaseAdmin
    .from('venue_concierge_messages')
    .select('id, venue_id, sender_kind, sender_support_user_id, sender_label, body, created_at')
    .eq('venue_id', user.venueId)
    .order('created_at', { ascending: true });
  const msgs = ((rows ?? []) as unknown) as MsgRow[];

  // Resolve concierge author identities (name + avatar) for display.
  const supportIds = Array.from(
    new Set(msgs.map((m) => m.sender_support_user_id).filter((x): x is string => !!x)),
  );
  const authorById: Record<string, { name: string; avatarUrl: string | null }> = {};
  if (supportIds.length > 0) {
    const { data: people } = await supabaseAdmin
      .from('support_team_members')
      .select('id, name, first_name, last_name, avatar_url')
      .in('id', supportIds);
    for (const p of (people ?? []) as Array<{
      id: string; name: string | null; first_name: string | null; last_name: string | null; avatar_url: string | null;
    }>) {
      const full = [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || p.name || 'StoryVenue Concierge';
      authorById[p.id] = { name: full, avatarUrl: p.avatar_url };
    }
  }

  const messages = msgs.map((m) => {
    const author = m.sender_support_user_id ? authorById[m.sender_support_user_id] : undefined;
    return {
      id: m.id,
      fromConcierge: m.sender_kind === 'concierge',
      body: m.body,
      createdAt: m.created_at,
      authorName: m.sender_kind === 'concierge'
        ? (author?.name || 'StoryVenue Concierge')
        : (m.sender_label || 'You'),
      authorAvatar: m.sender_kind === 'concierge' ? (author?.avatarUrl ?? null) : null,
    };
  });

  // Mark the venue-side read cursor current (best-effort).
  await supabaseAdmin
    .from('venue_concierge_reads')
    .upsert(
      { venue_id: user.venueId, reader_ref: VENUE_READER_REF, last_read_at: new Date().toISOString() },
      { onConflict: 'venue_id,reader_ref' },
    );

  return NextResponse.json({ messages });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let payload: { body?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const text = (payload.body || '').trim();
  if (!text) return NextResponse.json({ error: 'Empty message' }, { status: 400 });

  const senderLabel = user.memberName || user.venueName || 'Venue';

  const { data: msg, error } = await supabaseAdmin
    .from('venue_concierge_messages')
    .insert({
      venue_id: user.venueId,
      sender_kind: 'venue',
      sender_label: senderLabel,
      body: text,
    })
    .select('id, created_at')
    .single();

  if (error || !msg) {
    return NextResponse.json({ error: error?.message || 'Failed to send' }, { status: 500 });
  }

  // Sender is caught up on their own message.
  await supabaseAdmin
    .from('venue_concierge_reads')
    .upsert(
      { venue_id: user.venueId, reader_ref: VENUE_READER_REF, last_read_at: new Date().toISOString() },
      { onConflict: 'venue_id,reader_ref' },
    );

  return NextResponse.json({ ok: true, id: (msg as { id: string }).id });
}
