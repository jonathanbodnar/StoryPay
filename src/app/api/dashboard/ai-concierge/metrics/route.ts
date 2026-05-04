/**
 * Venue-facing AI Concierge metrics — last N days for the signed-in venue.
 *
 *   GET ?days=30  (default 30, clamped to 1..365)
 *
 * Returns a payload optimized for the dashboard summary card. The metrics
 * are computed live from `ai_runs`, `ai_state_transitions`, and `leads`
 * scoped to the requesting venue, so they always reflect the operator's
 * own data — no cross-venue leakage.
 *
 * Returned shape:
 *   {
 *     windowDays:        number,
 *     windowStartIso:    ISO timestamp,
 *     // Volume
 *     messagesSent:      number,   // ai_runs outcome='sent'
 *     leadsReplied:      number,   // distinct leads who transitioned out of ai_active to a reply state
 *     replyRate:         0..1 number,   // leadsReplied / activated (capped 0..1)
 *     // Outcomes (by ai_state_transitions.to_state in window)
 *     handedOff:         number,   // → handoff
 *     optedOut:          number,   // → opted_out
 *     exhausted:         number,   // → exhausted
 *     activated:         number,   // → ai_active (first activations + re-enables)
 *     // Live snapshot (NOT windowed)
 *     activeNow:         number,
 *     pausedNow:         number,
 *     handoffNow:        number,
 *     // Spend (today, via venue tz)
 *     sentToday:         number,
 *     effectiveDailyCap: number,
 *     // Eligibility (for "is the engine even on?" copy)
 *     enabled:           boolean,
 *     a2pVerified:       boolean,
 *     addonActive:       boolean,
 *   }
 *
 * Note on `leadsReplied`: we count it as the number of distinct leads whose
 * AI state moved FROM ai_active TO {paused, handoff, opted_out} during the
 * window. That's a more meaningful "engagement" metric than raw inbound
 * message count (a chatty bride shouldn't 5x the number).
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSessionUser } from '@/lib/session';
import { evaluateSpendCap } from '@/lib/ai-concierge/spend-caps';

export const dynamic = 'force-dynamic';

interface MetricsPayload {
  windowDays:        number;
  windowStartIso:    string;
  messagesSent:      number;
  leadsReplied:      number;
  replyRate:         number;
  handedOff:         number;
  optedOut:          number;
  exhausted:         number;
  activated:         number;
  activeNow:         number;
  pausedNow:         number;
  handoffNow:        number;
  sentToday:         number;
  effectiveDailyCap: number;
  enabled:           boolean;
  a2pVerified:       boolean;
  addonActive:       boolean;
}

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!user.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(request.url);
  const daysRaw = Number(url.searchParams.get('days') ?? '30');
  const windowDays = Number.isFinite(daysRaw)
    ? Math.max(1, Math.min(365, Math.floor(daysRaw)))
    : 30;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const sinceIso = since.toISOString();

  const venueId = user.venueId;

  // Eligibility flags — also tells the UI whether to show a "you're not on
  // the engine yet" prompt instead of empty zeros.
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id, ai_concierge_enabled, a2p_verified, directory_addon_concierge')
    .eq('id', venueId)
    .maybeSingle();

  // Run all the counting queries in parallel — each one is tiny.
  const [
    sentCount,
    transitionCounts,
    activeNow,
    pausedNow,
    handoffNow,
    spend,
  ] = await Promise.all([
    countAiRuns(venueId, sinceIso, 'sent'),
    countTransitions(venueId, sinceIso),
    countLeads(venueId, 'ai_active'),
    countLeads(venueId, 'paused'),
    countLeads(venueId, 'handoff'),
    safeEvaluateSpendCap(venueId),
  ]);

  // Reply count = distinct leads who left ai_active into a reply-driven state
  // during the window. Captures meaningful engagement without double-counting
  // chatty brides.
  const leadsReplied = transitionCounts.repliedLeadIds.size;

  const replyDenom = transitionCounts.ai_active;
  const replyRate = replyDenom > 0
    ? Math.round((leadsReplied / replyDenom) * 1000) / 1000
    : 0;

  const payload: MetricsPayload = {
    windowDays,
    windowStartIso:    sinceIso,
    messagesSent:      sentCount,
    leadsReplied,
    replyRate,
    handedOff:         transitionCounts.handoff,
    optedOut:          transitionCounts.opted_out,
    exhausted:         transitionCounts.exhausted,
    activated:         transitionCounts.ai_active,
    activeNow,
    pausedNow,
    handoffNow,
    sentToday:         spend.countToday,
    effectiveDailyCap: spend.effectiveCap,
    enabled:           venue?.ai_concierge_enabled === true,
    a2pVerified:       venue?.a2p_verified === true,
    addonActive:       venue?.directory_addon_concierge === true,
  };

  return NextResponse.json(payload);
}

// ── Helpers ─────────────────────────────────────────────────────────────

async function countAiRuns(venueId: string, sinceIso: string, outcome: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('ai_runs')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', venueId)
    .eq('outcome',  outcome)
    .gte('created_at', sinceIso);
  if (error && error.code !== '42P01') {
    console.error('[ai-concierge metrics] countAiRuns error:', error.message);
  }
  return typeof count === 'number' ? count : 0;
}

interface TransitionBucket {
  handoff:   number;
  opted_out: number;
  exhausted: number;
  ai_active: number;
  /** Distinct lead IDs that left ai_active into a reply-driven state. */
  repliedLeadIds: Set<string>;
}

async function countTransitions(venueId: string, sinceIso: string): Promise<TransitionBucket> {
  const { data, error } = await supabaseAdmin
    .from('ai_state_transitions')
    .select('lead_id, from_state, to_state')
    .eq('venue_id', venueId)
    .gte('created_at', sinceIso)
    .limit(10_000);

  const out: TransitionBucket = {
    handoff: 0, opted_out: 0, exhausted: 0, ai_active: 0,
    repliedLeadIds: new Set<string>(),
  };
  if (error) {
    if (error.code !== '42P01') {
      console.error('[ai-concierge metrics] countTransitions error:', error.message);
    }
    return out;
  }
  for (const row of (data ?? []) as { lead_id: string; from_state: string | null; to_state: string }[]) {
    if (row.to_state === 'handoff')   out.handoff   += 1;
    if (row.to_state === 'opted_out') out.opted_out += 1;
    if (row.to_state === 'exhausted') out.exhausted += 1;
    if (row.to_state === 'ai_active') out.ai_active += 1;
    if (row.from_state === 'ai_active'
        && (row.to_state === 'paused' || row.to_state === 'handoff' || row.to_state === 'opted_out')) {
      out.repliedLeadIds.add(row.lead_id);
    }
  }
  return out;
}

async function countLeads(venueId: string, state: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', venueId)
    .eq('ai_state', state);
  return typeof count === 'number' ? count : 0;
}

async function safeEvaluateSpendCap(venueId: string): Promise<{ countToday: number; effectiveCap: number }> {
  try {
    const r = await evaluateSpendCap(venueId);
    return { countToday: r.countToday, effectiveCap: r.effectiveCap };
  } catch (e) {
    console.error('[ai-concierge metrics] evaluateSpendCap failed:', e);
    return { countToday: 0, effectiveCap: 100 };
  }
}
