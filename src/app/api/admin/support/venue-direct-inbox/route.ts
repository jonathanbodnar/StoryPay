/**
 * GET /api/admin/support/venue-direct-inbox
 *
 * Concierge-side inbox of every conversation thread that has Venue Direct
 * activity (i.e. at least one audience='venue_direct' message), ordered by
 * latest message. Each row is annotated with whether the latest message is
 * from the venue (concierge needs to respond) so the UI can prioritize.
 */

import { NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface MsgRow {
  id:                      string;
  thread_id:               string;
  body:                    string;
  sender_kind:             string;
  sent_by_support_user_id: string | null;
  venue_team_member_id:    string | null;
  contact_from_name:       string | null;
  contact_from_email:      string | null;
  created_at:              string;
}

interface ThreadRow {
  id:                string;
  venue_id:          string;
  venue_customer_id: string;
}

interface VenueRow {
  id:   string;
  name: string | null;
}

interface ContactRow {
  id:             string;
  customer_email: string | null;
  first_name:     string | null;
  last_name:      string | null;
}

export async function GET() {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Pull recent venue_direct messages (cap so the page stays fast)
  const { data: msgs, error } = await supabaseAdmin
    .from('conversation_messages')
    .select('id, thread_id, body, sender_kind, sent_by_support_user_id, venue_team_member_id, contact_from_name, contact_from_email, created_at')
    .eq('audience', 'venue_direct')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const allMsgs = (msgs ?? []) as MsgRow[];
  if (allMsgs.length === 0) return NextResponse.json({ threads: [], unreadCount: 0 });

  // Group by thread → keep latest only
  const byThread = new Map<string, MsgRow>();
  for (const m of allMsgs) {
    if (!byThread.has(m.thread_id)) byThread.set(m.thread_id, m);
  }

  // Resolve threads → venues + contacts
  const threadIds = Array.from(byThread.keys());
  const { data: threads } = await supabaseAdmin
    .from('conversation_threads')
    .select('id, venue_id, venue_customer_id')
    .in('id', threadIds);
  const threadById: Record<string, ThreadRow> = {};
  for (const t of (threads ?? []) as ThreadRow[]) threadById[t.id] = t;

  const venueIds   = Array.from(new Set(Object.values(threadById).map(t => t.venue_id)));
  const contactIds = Array.from(new Set(Object.values(threadById).map(t => t.venue_customer_id)));

  const venueById:   Record<string, VenueRow>   = {};
  const contactById: Record<string, ContactRow> = {};
  if (venueIds.length > 0) {
    const { data } = await supabaseAdmin
      .from('venues')
      .select('id, name')
      .in('id', venueIds);
    for (const v of (data ?? []) as VenueRow[]) venueById[v.id] = v;
  }
  if (contactIds.length > 0) {
    const { data } = await supabaseAdmin
      .from('venue_customers')
      .select('id, customer_email, first_name, last_name')
      .in('id', contactIds);
    for (const c of (data ?? []) as ContactRow[]) contactById[c.id] = c;
  }

  // Resolve concierge author names for the latest-msg preview
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

  // Resolve venue team member names for venue-replied messages + read receipts
  const memberIds = Array.from(new Set(
    allMsgs.map(m => m.venue_team_member_id).filter((x): x is string => !!x),
  ));
  const memberNames: Record<string, string> = {};
  const memberById: Record<string, { id: string; name: string }> = {};
  if (memberIds.length > 0) {
    const { data: rows } = await supabaseAdmin
      .from('venue_team_members')
      .select('id, name, first_name, last_name')
      .in('id', memberIds);
    for (const r of (rows ?? []) as Array<{ id: string; name: string | null; first_name: string | null; last_name: string | null }>) {
      const displayName = [r.first_name, r.last_name].filter(Boolean).join(' ') || r.name || 'Team member';
      memberNames[r.id]  = displayName;
      memberById[r.id]   = { id: r.id, name: displayName };
    }
  }

  // Read receipts + concierge acknowledgments: fetch who on the venue side
  // has read each thread and when, plus any 'vd:concierge' ack timestamps.
  const { data: readRows } = await supabaseAdmin
    .from('conversation_thread_reads')
    .select('thread_id, reader_ref, last_read_at')
    .in('thread_id', threadIds)
    .like('reader_ref', 'vd:%');

  // Index concierge acknowledgment timestamps per thread
  const conciergeAckAt: Record<string, string> = {};
  for (const rr of (readRows ?? []) as Array<{ thread_id: string; reader_ref: string; last_read_at: string }>) {
    if (rr.reader_ref === 'vd:concierge') {
      conciergeAckAt[rr.thread_id] = rr.last_read_at;
    }
  }
  interface ReadRow { thread_id: string; reader_ref: string; last_read_at: string }
  const readsByThread: Record<string, Array<{ label: string; readAt: string }>> = {};
  for (const rr of (readRows ?? []) as ReadRow[]) {
    const ref = rr.reader_ref;
    let label = 'Venue owner';
    if (ref.startsWith('vd:m:')) {
      const mId = ref.slice('vd:m:'.length);
      label = memberById[mId]?.name ?? 'Team member';
    }
    if (!readsByThread[rr.thread_id]) readsByThread[rr.thread_id] = [];
    readsByThread[rr.thread_id].push({ label, readAt: rr.last_read_at });
  }

  // For each thread, also find the last concierge-sent message (for "last contacted" chip)
  // and all venue-side messages after the last concierge message (for read receipt calculation).
  const lastConciergeMsgByThread = new Map<string, MsgRow>();
  for (const m of allMsgs) {
    if (m.sender_kind === 'concierge' && !lastConciergeMsgByThread.has(m.thread_id)) {
      lastConciergeMsgByThread.set(m.thread_id, m);
    }
  }

  let unreadCount = 0;
  const out = Array.from(byThread.entries()).map(([threadId, latest]) => {
    const t = threadById[threadId];
    const v = t ? venueById[t.venue_id] : null;
    const c = t ? contactById[t.venue_customer_id] : null;
    const venueName  = v?.name || 'Unknown venue';
    const contactName = [c?.first_name, c?.last_name].filter(Boolean).join(' ').trim()
      || c?.customer_email
      || 'Unknown contact';
    const isFromConcierge = latest.sender_kind === 'concierge';
    // If the concierge acknowledged this thread at or after the last venue
    // message, treat it as "handled" — remove the "Awaiting reply" badge.
    const ackAt = conciergeAckAt[threadId];
    const isAcknowledged = !!ackAt && ackAt >= latest.created_at;
    const isFromVenue = !isFromConcierge && !isAcknowledged;
    if (isFromVenue) unreadCount += 1;

    const author = isFromConcierge
      ? (latest.sent_by_support_user_id && supportNames[latest.sent_by_support_user_id]) || 'StoryVenue Support'
      : (latest.venue_team_member_id && memberNames[latest.venue_team_member_id])
        || latest.contact_from_name
        || latest.contact_from_email
        || (latest.sender_kind === 'owner' ? 'Venue owner' : 'Venue team');

    const lastConciergeSentAt = lastConciergeMsgByThread.get(threadId)?.created_at ?? null;

    return {
      threadId,
      venueId:              t?.venue_id ?? null,
      venueName,
      contactId:            t?.venue_customer_id ?? null,
      contactName,
      latestBody:           latest.body,
      latestAuthor:         author,
      latestAt:             latest.created_at,
      latestFromVenue:      isFromVenue,
      lastConciergeSentAt,
      readReceipts: (readsByThread[threadId] ?? [])
                      .sort((a, b) => +new Date(b.readAt) - +new Date(a.readAt))
                      .slice(0, 3),
    };
  }).sort((a, b) => +new Date(b.latestAt) - +new Date(a.latestAt));

  return NextResponse.json({ threads: out, unreadCount });
}
