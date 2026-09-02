/**
 * Shared "needs attention" counters behind both the native app-icon badge
 * (src/app/api/notifications/badge-count/route.ts, polled by
 * NativeBadgeSync.tsx) and the APNs `aps.badge` field set on every native
 * push send (src/lib/native-push.ts). Mirrors the same three sources the
 * dashboard sidebar/tab-bar red pills already use.
 */

import { supabaseAdmin } from '@/lib/supabase';

const LEAD_PLACEHOLDER = '%@ghl-import.storyvenue.placeholder%';

export function vdReaderRef(memberId?: string | null): string {
  return memberId ? `vd:m:${memberId}` : 'vd:owner';
}

export async function getConversationsUnread(venueId: string, readerRef: string): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc('conversation_threads_with_meta', {
    p_venue_id: venueId,
    p_reader_ref: readerRef,
    p_unread_only: false,
    p_limit: 500,
  });
  if (error) return 0;
  const rows = (data ?? []) as { unread_count?: number | string }[];
  return rows.reduce((sum, r) => sum + Number(r.unread_count ?? 0), 0);
}

export async function getLeadsUnreadSince(venueId: string, since: string | null): Promise<number> {
  if (!since) return 0;
  const sinceDate = new Date(since);
  if (Number.isNaN(sinceDate.getTime())) return 0;
  const { count } = await supabaseAdmin
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', venueId)
    .gt('created_at', sinceDate.toISOString())
    .not('email', 'ilike', LEAD_PLACEHOLDER);
  return count ?? 0;
}

export async function getConciergeUnread(venueId: string, memberId?: string | null): Promise<number> {
  const { data: msgs } = await supabaseAdmin
    .from('conversation_messages')
    .select('thread_id, sender_kind, created_at, conversation_threads!inner(venue_id)')
    .eq('audience', 'venue_direct')
    .eq('conversation_threads.venue_id', venueId);

  type Row = { thread_id: string; sender_kind: string; created_at: string };
  const conciergeMsgs = ((msgs ?? []) as Row[]).filter((m) => m.sender_kind === 'concierge');
  if (conciergeMsgs.length === 0) return 0;

  const ref = vdReaderRef(memberId);
  const threadIds = Array.from(new Set(conciergeMsgs.map((m) => m.thread_id)));
  const { data: reads } = await supabaseAdmin
    .from('conversation_thread_reads')
    .select('thread_id, last_read_at')
    .eq('reader_ref', ref)
    .in('thread_id', threadIds);

  const lastReadAt: Record<string, string> = {};
  for (const r of (reads ?? []) as Array<{ thread_id: string; last_read_at: string }>) {
    lastReadAt[r.thread_id] = r.last_read_at;
  }

  let count = 0;
  for (const m of conciergeMsgs) {
    const last = lastReadAt[m.thread_id];
    if (!last || new Date(m.created_at) > new Date(last)) count += 1;
  }
  return count;
}

/**
 * Unread count for the general Venue Concierge channel (migration 211) — the
 * $499 add-on relationship thread, distinct from the per-contact venue_direct
 * concierge messages counted by getConciergeUnread. Counts concierge-authored
 * messages newer than the venue's own read cursor.
 */
export async function getVenueConciergeChannelUnread(venueId: string): Promise<number> {
  const { data: readRow } = await supabaseAdmin
    .from('venue_concierge_reads')
    .select('last_read_at')
    .eq('venue_id', venueId)
    .eq('reader_ref', 'venue')
    .maybeSingle();
  const lastReadAt = (readRow as { last_read_at?: string } | null)?.last_read_at ?? null;

  let q = supabaseAdmin
    .from('venue_concierge_messages')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', venueId)
    .eq('sender_kind', 'concierge');
  if (lastReadAt) q = q.gt('created_at', lastReadAt);
  const { count } = await q;
  return count ?? 0;
}

/**
 * Best-effort badge total to stamp on a native push at send time.
 * Native push toggles are venue-wide (not per-team-member — see
 * owner-notifications.ts), so every device on the venue gets the same push
 * today; we badge against the OWNER's read state for the same reason.
 *
 * Leads are intentionally excluded here: "unread leads" only has meaning
 * relative to a per-device localStorage baseline the server doesn't have
 * (see LEADS_SEEN_KEY). NativeBadgeSync.tsx adds them back into the badge
 * within one poll cycle of the app being foregrounded, so the icon
 * self-corrects to the fully accurate count almost immediately.
 */
export async function getServerBadgeCount(venueId: string): Promise<number> {
  const [conversations, concierge, venueConcierge] = await Promise.all([
    getConversationsUnread(venueId, 'owner').catch(() => 0),
    getConciergeUnread(venueId, null).catch(() => 0),
    getVenueConciergeChannelUnread(venueId).catch(() => 0),
  ]);
  return conversations + concierge + venueConcierge;
}
