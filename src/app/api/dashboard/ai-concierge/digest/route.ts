/**
 * GET /api/dashboard/ai-concierge/digest
 *
 * Venue-scoped AI Concierge activity digest for the Bride Booking System
 * dashboard card. Reads the `venue_id` cookie, then gates on concierge
 * access (loadVenueFeatureAccess().hasConcierge) — a venue without concierge
 * gets a 403 with { locked: true } so the client renders the locked card and
 * never fetches stats.
 *
 * Respects the SAME date range the dashboard already uses:
 *   GET ?from=YYYY-MM-DD&to=YYYY-MM-DD   (inclusive)
 *
 * Returns:
 *   {
 *     sent:               number,  // ai_runs outcome='sent' in window
 *     replies:            number,  // inbound bride replies, last-touch attributed
 *     replyRate:          number,  // replies ÷ sent (%)
 *     movedNotInterested: number,  // distinct leads the AI moved to opted-out/not-interested
 *   }
 */

import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { loadVenueFeatureAccess } from '@/lib/plan-features';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface SentRun { lead_id: string; created_at: string; }

export async function GET(request: NextRequest) {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Concierge gate — no access means no stats. Client renders the locked card.
  const access = await loadVenueFeatureAccess(venueId);
  if (!access.hasConcierge) {
    return NextResponse.json({ error: 'AI Concierge is not active for this venue', locked: true }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const fromStr = sp.get('from');
  const toStr = sp.get('to');
  let sinceIso: string | null = null;
  let untilIso: string | null = null;
  if (fromStr) sinceIso = new Date(`${fromStr}T00:00:00.000Z`).toISOString();
  if (toStr) untilIso = new Date(`${toStr}T23:59:59.999Z`).toISOString();
  if (!fromStr && !toStr) {
    sinceIso = new Date(Date.now() - 30 * 86_400_000).toISOString();
  }

  try {
    // 1) Texts sent in the window.
    let sentQ = supabaseAdmin
      .from('ai_runs')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', venueId)
      .eq('outcome', 'sent');
    if (sinceIso) sentQ = sentQ.gte('created_at', sinceIso);
    if (untilIso) sentQ = sentQ.lte('created_at', untilIso);
    const { count: sentCount, error: sentErr } = await sentQ;
    if (sentErr && sentErr.code !== '42P01') throw sentErr;
    const sent = typeof sentCount === 'number' ? sentCount : 0;

    // 2) Inbound bride replies + "moved to Not Interested" in the window.
    let txnQ = supabaseAdmin
      .from('ai_state_transitions')
      .select('lead_id, reason, to_state, created_at')
      .eq('venue_id', venueId)
      .limit(10_000);
    if (sinceIso) txnQ = txnQ.gte('created_at', sinceIso);
    if (untilIso) txnQ = txnQ.lte('created_at', untilIso);
    const { data: txns, error: txnErr } = await txnQ;
    if (txnErr && txnErr.code !== '42P01') throw txnErr;

    const firstReplyByLead = new Map<string, string>();
    const notInterestedLeads = new Set<string>();
    for (const t of (txns ?? []) as Array<{ lead_id: string; reason: string | null; to_state: string; created_at: string }>) {
      if (t.reason && t.reason.startsWith('inbound_')) {
        const prev = firstReplyByLead.get(t.lead_id);
        if (!prev || t.created_at < prev) firstReplyByLead.set(t.lead_id, t.created_at);
      }
      // The AI moves a bride to the "Not Interested" pipeline on opt-out /
      // negative intent (both land the lead in the opted_out state).
      if (t.to_state === 'opted_out') notInterestedLeads.add(t.lead_id);
    }

    // 3) Last-touch attribution: credit a reply only when there was a prior
    //    AI 'sent' run for that lead (matches the SMS analytics approach).
    let replies = 0;
    const repliedLeadIds = Array.from(firstReplyByLead.keys());
    if (repliedLeadIds.length > 0) {
      const runsByLead = new Map<string, SentRun[]>();
      const chunkSize = 200;
      for (let i = 0; i < repliedLeadIds.length; i += chunkSize) {
        const chunk = repliedLeadIds.slice(i, i + chunkSize);
        let runQ = supabaseAdmin
          .from('ai_runs')
          .select('lead_id, created_at')
          .eq('venue_id', venueId)
          .eq('outcome', 'sent')
          .in('lead_id', chunk)
          .order('created_at', { ascending: false });
        if (untilIso) runQ = runQ.lte('created_at', untilIso);
        const { data: runs, error: runErr } = await runQ;
        if (runErr && runErr.code !== '42P01') throw runErr;
        for (const r of (runs ?? []) as SentRun[]) {
          const arr = runsByLead.get(r.lead_id) ?? [];
          arr.push(r);
          runsByLead.set(r.lead_id, arr);
        }
      }
      for (const [leadId, replyAt] of firstReplyByLead) {
        const runs = runsByLead.get(leadId);
        if (runs && runs.some((run) => run.created_at <= replyAt)) replies += 1;
      }
    }

    return NextResponse.json({
      sent,
      replies,
      replyRate: sent > 0 ? Math.round((replies / sent) * 1000) / 10 : 0,
      movedNotInterested: notInterestedLeads.size,
    });
  } catch (e) {
    console.error('[ai-concierge digest] failed:', e);
    return NextResponse.json({ error: (e as Error).message ?? 'Failed' }, { status: 500 });
  }
}
