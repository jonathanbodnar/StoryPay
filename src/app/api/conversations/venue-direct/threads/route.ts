/**
 * GET /api/conversations/venue-direct/threads
 *
 * Lists every contact for the current venue that has an active "Venue Direct"
 * thread (i.e. at least one audience='venue_direct' message), ordered by
 * most-recent activity. Each row includes:
 *   - contact id, name, email, phone
 *   - latest message preview + author + timestamp
 *   - unread count for the current viewer
 *
 * Used by /dashboard/concierge to give venues a single inbox of every
 * conversation StoryVenue Support has had with them about specific brides.
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { getSessionUser, type SessionUser } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function vdReaderRef(user: SessionUser): string {
  return user.memberId ? `vd:m:${user.memberId}` : 'vd:owner';
}

interface MsgRow {
  id:                      string;
  thread_id:               string;
  body:                    string;
  sender_kind:             string;
  sent_by_support_user_id: string | null;
  venue_team_member_id:    string | null;
  created_at:              string;
}

interface ThreadRow {
  id:                string;
  venue_customer_id: string;
}

interface ContactRow {
  id:                  string;
  customer_email:      string | null;
  first_name:          string | null;
  last_name:           string | null;
  phone:               string | null;
}

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = await getSessionUser();
  if (!user)    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // 1. All venue_direct messages on threads belonging to this venue
  const { data: msgs } = await supabaseAdmin
    .from('conversation_messages')
    .select(`
      id, thread_id, body, sender_kind, sent_by_support_user_id, venue_team_member_id, created_at,
      conversation_threads!inner(venue_id)
    `)
    .eq('audience', 'venue_direct')
    .eq('conversation_threads.venue_id', venueId)
    .order('created_at', { ascending: false });
  const allMsgs = ((msgs ?? []) as unknown) as MsgRow[];
  if (allMsgs.length === 0) return NextResponse.json({ threads: [] });

  // 2. Group by thread → keep latest + count concierge-authored msgs
  const byThread = new Map<string, { latest: MsgRow; conciergeMsgs: MsgRow[] }>();
  for (const m of allMsgs) {
    const cur = byThread.get(m.thread_id);
    if (cur) {
      if (m.sender_kind === 'concierge') cur.conciergeMsgs.push(m);
    } else {
      byThread.set(m.thread_id, {
        latest: m,
        conciergeMsgs: m.sender_kind === 'concierge' ? [m] : [],
      });
    }
  }

  // 3. Resolve thread → contact mapping
  const threadIds = Array.from(byThread.keys());
  const { data: threads } = await supabaseAdmin
    .from('conversation_threads')
    .select('id, venue_customer_id')
    .in('id', threadIds);
  const threadToContact: Record<string, string> = {};
  for (const t of (threads ?? []) as ThreadRow[]) {
    threadToContact[t.id] = t.venue_customer_id;
  }

  // 4. Resolve contact metadata
  const contactIds = Array.from(new Set(Object.values(threadToContact)));
  const contactById: Record<string, ContactRow> = {};
  if (contactIds.length > 0) {
    const { data: contacts } = await supabaseAdmin
      .from('venue_customers')
      .select('id, customer_email, first_name, last_name, phone')
      .eq('venue_id', venueId)
      .in('id', contactIds);
    for (const c of (contacts ?? []) as ContactRow[]) contactById[c.id] = c;
  }

  // 5. Per-viewer read state
  const ref = vdReaderRef(user);
  const { data: reads } = await supabaseAdmin
    .from('conversation_thread_reads')
    .select('thread_id, last_read_at')
    .eq('reader_ref', ref)
    .in('thread_id', threadIds);
  const lastReadAt: Record<string, string> = {};
  for (const r of (reads ?? []) as Array<{ thread_id: string; last_read_at: string }>) {
    lastReadAt[r.thread_id] = r.last_read_at;
  }

  // 6. Resolve concierge author names (for the latest-msg preview)
  const supportIds = Array.from(new Set(
    allMsgs.map(m => m.sent_by_support_user_id).filter((x): x is string => !!x),
  ));
  const supportNames: Record<string, string> = {};
  if (supportIds.length > 0) {
    const { data: rows } = await supabaseAdmin
      .from('support_team_members')
      .select('id, name')
      .in('id', supportIds);
    for (const r of (rows ?? []) as Array<{ id: string; name: string | null }>) {
      supportNames[r.id] = r.name || 'StoryVenue Support';
    }
  }

  // 7. Assemble + sort by latest message desc
  const out = Array.from(byThread.entries()).map(([threadId, group]) => {
    const contactId = threadToContact[threadId];
    const c = contactId ? contactById[contactId] : null;
    const latest = group.latest;
    const lastRead = lastReadAt[threadId];
    const unread = group.conciergeMsgs.filter(m =>
      !lastRead || new Date(m.created_at) > new Date(lastRead),
    ).length;
    const contactName = [c?.first_name, c?.last_name].filter(Boolean).join(' ').trim()
      || c?.customer_email
      || 'Unknown contact';
    const latestAuthor = latest.sender_kind === 'concierge'
      ? (latest.sent_by_support_user_id && supportNames[latest.sent_by_support_user_id]
          ? `StoryVenue Support · ${supportNames[latest.sent_by_support_user_id]}`
          : 'StoryVenue Support')
      : 'You';
    return {
      threadId,
      contactId,
      contactName,
      contactEmail: c?.customer_email || null,
      latestBody:   latest.body,
      latestAuthor,
      latestAt:     latest.created_at,
      latestFromConcierge: latest.sender_kind === 'concierge',
      unreadCount:  unread,
    };
  }).sort((a, b) => +new Date(b.latestAt) - +new Date(a.latestAt));

  return NextResponse.json({ threads: out });
}
