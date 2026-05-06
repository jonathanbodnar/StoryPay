/**
 * GET /api/admin/support/inbox-count
 *
 * Returns the number of items that need attention in the support inbox:
 *   brideReplies  – threads where the bride was the last to speak (needs reply)
 *   openTickets   – venue-support tickets with status 'open' or 'pending'
 *   total         – sum of the above
 *
 * Used to drive the sidebar badge on the super-admin side.
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
    // We look at the most recent external message per thread. If it's from
    // 'contact' (the bride), that thread is "open / needs reply".
    // Pull a generous recent window (400 msgs) then dedupe in JS.
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
    const brideReplies = Array.from(latestByThread.values()).filter(s => s === 'contact').length;

    // ── 2. Open/pending venue support tickets ────────────────────────────────
    const { count: openTickets } = await supabaseAdmin
      .from('support_threads')
      .select('id', { count: 'exact', head: true })
      .in('status', ['open', 'pending']);

    return NextResponse.json({
      brideReplies,
      openTickets:  openTickets ?? 0,
      total:        brideReplies + (openTickets ?? 0),
    });
  } catch (err) {
    console.error('[inbox-count]', err);
    return NextResponse.json({ brideReplies: 0, openTickets: 0, total: 0 });
  }
}
