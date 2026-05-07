/**
 * GET /api/admin/support/inbox-count
 *
 * Returns the number of items that need attention in the support inbox:
 *   brideReplies  – open threads where the bride was the last to speak
 *   venueReplies  – venue_direct threads where the venue (or owner) replied
 *                   and the concierge hasn't responded *or* acknowledged
 *   openTickets   – venue-support tickets with status 'open' or 'pending'
 *   total         – sum of the above
 *
 * Drives the sidebar badge on the super-admin side. Stays in sync with
 * the in-panel sub-tab badges by applying the same close/ack rules
 * those sub-tabs use:
 *   - bride threads with status='closed' are excluded from brideReplies
 *   - venue_direct threads with a 'vd:concierge' read row at or after the
 *     latest message are excluded from venueReplies
 */
import { NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // ── 1. Bride replies that need attention ─────────────────────────────────
    // Keep only the latest external message per thread; flag threads where
    // the bride was the last to speak. Then filter out any thread that's
    // been manually closed (status='closed') so the close button truly
    // clears the badge.
    const { data: recentExtRows } = await supabaseAdmin
      .from('conversation_messages')
      .select('thread_id, sender_kind, created_at')
      .eq('visibility', 'external')
      .order('created_at', { ascending: false })
      .limit(400);

    const latestByThread = new Map<string, string>();
    for (const r of (recentExtRows ?? []) as Array<{ thread_id: string; sender_kind: string; created_at: string }>) {
      if (!latestByThread.has(r.thread_id)) latestByThread.set(r.thread_id, r.sender_kind);
    }
    const brideReplyThreadIds = Array.from(latestByThread.entries())
      .filter(([, kind]) => kind === 'contact')
      .map(([tid]) => tid);

    let brideReplies = brideReplyThreadIds.length;
    if (brideReplyThreadIds.length > 0) {
      // Subtract closed threads (the column may not exist on older DBs;
      // PostgREST returns 42703 in that case, which we treat as no rows).
      const { data: closedRows } = await supabaseAdmin
        .from('conversation_threads')
        .select('id')
        .in('id', brideReplyThreadIds)
        .eq('status', 'closed');
      const closedSet = new Set(((closedRows ?? []) as Array<{ id: string }>).map(r => r.id));
      brideReplies = brideReplyThreadIds.filter(id => !closedSet.has(id)).length;
    }

    // ── 2. Venue Direct replies that need concierge attention ────────────────
    // Look at the latest venue_direct message per thread. If sender_kind is
    // not 'concierge' the concierge is expected to respond — UNLESS the
    // concierge has already acknowledged it via 'vd:concierge' in
    // conversation_thread_reads (which the Close button on a bride thread
    // also sets, so the badge clears in lockstep).
    const { data: recentVdRows } = await supabaseAdmin
      .from('conversation_messages')
      .select('thread_id, sender_kind, created_at')
      .eq('audience', 'venue_direct')
      .order('created_at', { ascending: false })
      .limit(400);
    const latestVdByThread = new Map<string, { kind: string; at: string }>();
    for (const r of (recentVdRows ?? []) as Array<{ thread_id: string; sender_kind: string; created_at: string }>) {
      if (!latestVdByThread.has(r.thread_id)) {
        latestVdByThread.set(r.thread_id, { kind: r.sender_kind, at: r.created_at });
      }
    }
    const awaitingVdThreadIds = Array.from(latestVdByThread.entries())
      .filter(([, v]) => v.kind !== 'concierge')
      .map(([tid]) => tid);

    let venueReplies = 0;
    if (awaitingVdThreadIds.length > 0) {
      const { data: ackRows } = await supabaseAdmin
        .from('conversation_thread_reads')
        .select('thread_id, last_read_at')
        .in('thread_id', awaitingVdThreadIds)
        .eq('reader_ref', 'vd:concierge');
      const ackByThread = new Map<string, string>();
      for (const r of (ackRows ?? []) as Array<{ thread_id: string; last_read_at: string }>) {
        ackByThread.set(r.thread_id, r.last_read_at);
      }
      venueReplies = awaitingVdThreadIds.filter(tid => {
        const latest = latestVdByThread.get(tid);
        const ack    = ackByThread.get(tid);
        if (!latest) return false;
        return !ack || ack < latest.at;
      }).length;
    }

    // ── 3. Open/pending venue support tickets ────────────────────────────────
    const { count: openTickets } = await supabaseAdmin
      .from('support_threads')
      .select('id', { count: 'exact', head: true })
      .in('status', ['open', 'pending']);

    return NextResponse.json({
      brideReplies,
      venueReplies,
      openTickets:  openTickets ?? 0,
      total:        brideReplies + venueReplies + (openTickets ?? 0),
    });
  } catch (err) {
    console.error('[inbox-count]', err);
    return NextResponse.json({ brideReplies: 0, venueReplies: 0, openTickets: 0, total: 0 });
  }
}
