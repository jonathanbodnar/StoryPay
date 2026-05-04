/**
 * Super-admin venue overview for AI Concierge.
 *
 * Returns one row per venue with its AI Concierge eligibility and lead-state
 * counters, so the operator can see at a glance which venues are turned on,
 * which are stuck on A2P, and where the active leads are concentrated.
 *
 *   GET ?search=<q>
 *
 * Returns:
 *   {
 *     venues: AiVenueRow[],
 *     totals: { totalVenues, addonHolders, aiEnabled, a2pVerified, eligibleNotEnabled }
 *   }
 *
 * No paging for now — the venue count fits in a single response (300 rows
 * comfortably). If we ever exceed that we'll add cursor paging.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getAiRuntimeSettings } from '@/lib/ai-concierge/runtime-settings';

export const dynamic = 'force-dynamic';

interface RawVenue {
  id:                          string;
  name:                        string | null;
  email:                       string | null;
  ai_concierge_enabled:        boolean | null;
  a2p_verified:                boolean | null;
  directory_addon_concierge:   boolean | null;
  ai_assistant_persona_name:   string | null;
  ai_concierge_enabled_at:     string | null;
  sms_provider:                string | null;
  ghl_location_id:             string | null;
  created_at:                  string | null;
  // Migration 100 fields (A2P cache + spend caps). Optional in the type
  // because the GET works pre-migration too — we just read NULL for these.
  ai_daily_send_cap?:          number | null;
  ai_daily_alert_threshold_pct?: number | null;
  ai_alert_last_sent_at?:      string | null;
  a2p_brand_id?:               string | null;
  a2p_brand_status?:           string | null;
  a2p_campaign_id?:            string | null;
  a2p_campaign_status?:        string | null;
  a2p_last_checked_at?:        string | null;
  a2p_last_check_error?:       string | null;
}

interface AiVenueRow extends RawVenue {
  /** Lead state counts on this venue (only states that matter to the AI). */
  leadCounts: {
    ai_active:  number;
    paused:     number;
    handoff:    number;
    opted_out:  number;
    exhausted:  number;
    dormant:    number;
    total:      number;
  };
  /** Convenience flags derived server-side. */
  ghlConnected: boolean;
  isEligible:   boolean;   // addon AND a2p AND ghl
  /** Number of `ai_runs` rows with outcome='sent' in the last 24h, for spend-cap UX. */
  sentLast24h:  number;
  /** Effective cap = per-venue cap (if set) else platform default. */
  effectiveDailyCap: number;
}

export async function GET(request: NextRequest) {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url    = new URL(request.url);
  const search = (url.searchParams.get('search') ?? '').trim().toLowerCase();

  // Try the wider select that includes migration-100 columns. If those
  // columns don't exist yet, retry without them — we want this endpoint to
  // work both pre- and post-migration.
  const FULL_SELECT = 'id, name, email, ai_concierge_enabled, a2p_verified, directory_addon_concierge, ai_assistant_persona_name, ai_concierge_enabled_at, sms_provider, ghl_location_id, ai_daily_send_cap, ai_daily_alert_threshold_pct, ai_alert_last_sent_at, a2p_brand_id, a2p_brand_status, a2p_campaign_id, a2p_campaign_status, a2p_last_checked_at, a2p_last_check_error, created_at';
  const FALLBACK_SELECT = 'id, name, email, ai_concierge_enabled, a2p_verified, directory_addon_concierge, ai_assistant_persona_name, ai_concierge_enabled_at, sms_provider, ghl_location_id, created_at';

  let q = supabaseAdmin
    .from('venues')
    .select(FULL_SELECT)
    .order('created_at', { ascending: false })
    .limit(500);

  if (search) {
    // Match on name OR email (case-insensitive)
    q = q.or(`name.ilike.%${escapeIlike(search)}%,email.ilike.%${escapeIlike(search)}%`);
  }

  let { data: venuesRaw, error } = await q;
  if (error && error.code === '42703') {
    // Migration 100 (or 098) hasn't run yet — retry with the narrower select.
    let q2 = supabaseAdmin
      .from('venues')
      .select(FALLBACK_SELECT)
      .order('created_at', { ascending: false })
      .limit(500);
    if (search) {
      q2 = q2.or(`name.ilike.%${escapeIlike(search)}%,email.ilike.%${escapeIlike(search)}%`);
    }
    const retry = await q2;
    error = retry.error;
    // The narrower select returns a different inferred type; widen explicitly
    // so the outer `venuesRaw` keeps its FULL_SELECT shape (the missing fields
    // become `undefined` at runtime, which our `RawVenue` already models with
    // optional `?` properties).
    venuesRaw = retry.data as unknown as typeof venuesRaw;
  }
  if (error) {
    if (error.code === '42703') {
      return NextResponse.json({
        error: 'AI Concierge venue columns missing — run migration 098 first',
        schemaMissing: true,
      }, { status: 503 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const venues = (venuesRaw as RawVenue[] | null) ?? [];

  // Lead state counts: one round-trip via a single grouped query. We use the
  // raw postgres adapter for the GROUP BY — Supabase's `.select()` doesn't
  // support that cleanly, but we can lean on the `count` aggregate via a
  // dedicated RPC-ish fetch using `.eq` + `head: true` per state... which
  // is N venues × 6 states queries. Too many.
  //
  // Pragmatic compromise: pull the (venue_id, ai_state) pairs for non-dormant
  // states (the interesting ones), bucket them in JS. Dormant + total counts
  // come from a simple `count` per venue in parallel.
  const venueIds = venues.map((v) => v.id);
  const [counts, sent24h, runtime] = await Promise.all([
    fetchLeadStateCounts(venueIds),
    fetchSentLast24h(venueIds),
    getAiRuntimeSettings(),
  ]);
  const platformDefaultCap = runtime.defaultDailySendCap;

  // Apply hydration
  const rows: AiVenueRow[] = venues.map((v) => {
    const lc = counts.byVenue.get(v.id) ?? emptyCounts();
    const perVenueCap = typeof v.ai_daily_send_cap === 'number' ? v.ai_daily_send_cap : null;
    const effectiveCap = perVenueCap ?? platformDefaultCap;
    return {
      ...v,
      leadCounts:        lc,
      ghlConnected:      !!v.ghl_location_id,
      isEligible:
        v.directory_addon_concierge === true
        && v.a2p_verified         === true
        && !!v.ghl_location_id,
      sentLast24h:       sent24h.get(v.id) ?? 0,
      effectiveDailyCap: effectiveCap,
    };
  });

  const totals = {
    totalVenues:        venues.length,
    addonHolders:       venues.filter((v) => v.directory_addon_concierge === true).length,
    aiEnabled:          venues.filter((v) => v.ai_concierge_enabled === true).length,
    a2pVerified:        venues.filter((v) => v.a2p_verified === true).length,
    eligibleNotEnabled: rows.filter((r) => r.isEligible && r.ai_concierge_enabled !== true).length,
  };

  return NextResponse.json({ venues: rows, totals });
}

// ── Helpers ────────────────────────────────────────────────────────────────

function escapeIlike(input: string): string {
  // Escape Postgres ILIKE wildcards so search('20%') literally matches '20%'
  return input.replace(/[%_\\]/g, (m) => `\\${m}`);
}

function emptyCounts() {
  return { ai_active: 0, paused: 0, handoff: 0, opted_out: 0, exhausted: 0, dormant: 0, total: 0 };
}

interface FetchedCounts {
  byVenue: Map<string, ReturnType<typeof emptyCounts>>;
}

async function fetchLeadStateCounts(venueIds: string[]): Promise<FetchedCounts> {
  if (venueIds.length === 0) return { byVenue: new Map() };

  // Pull only the AI-engaged states explicitly. Dormant is by far the biggest
  // bucket — we approximate it as `total - sum(other states)` to avoid
  // dragging back rows for every never-activated lead in the system.
  //
  // We page in chunks of 1000 rows max via a single SELECT. Should be plenty
  // small (sum of ai_active+paused+handoff+opted_out+exhausted across the
  // whole platform is bounded by the active customer base).
  const { data: nonDormantRaw } = await supabaseAdmin
    .from('leads')
    .select('venue_id, ai_state')
    .in('venue_id', venueIds)
    .neq('ai_state', 'dormant')
    .limit(10_000);

  // Total leads per venue — small extra query for the dormant approximation.
  // We do a `count` query per venue in a single RPC by iterating; for ≤500
  // venues this is fine but parallelize for safety.
  const totalsByVenue = await Promise.all(venueIds.map(async (vid) => {
    const { count } = await supabaseAdmin
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', vid);
    return [vid, count ?? 0] as const;
  }));
  const totalMap = new Map<string, number>(totalsByVenue);

  const byVenue = new Map<string, ReturnType<typeof emptyCounts>>();
  for (const id of venueIds) byVenue.set(id, emptyCounts());

  const KNOWN_STATES = ['ai_active', 'paused', 'handoff', 'opted_out', 'exhausted'] as const;
  type KnownState = typeof KNOWN_STATES[number];
  const known: ReadonlySet<string> = new Set(KNOWN_STATES);

  for (const r of (nonDormantRaw ?? []) as { venue_id: string; ai_state: string }[]) {
    const bucket = byVenue.get(r.venue_id);
    if (!bucket) continue;
    if (known.has(r.ai_state)) bucket[r.ai_state as KnownState] += 1;
  }

  // Fold in totals + dormant (= total − non-dormant)
  for (const [vid, lc] of byVenue.entries()) {
    const nonDormant = lc.ai_active + lc.paused + lc.handoff + lc.opted_out + lc.exhausted;
    lc.total   = totalMap.get(vid) ?? 0;
    lc.dormant = Math.max(0, lc.total - nonDormant);
  }

  return { byVenue };
}

/**
 * One round-trip per call: pull every `ai_runs` row from the last 24 hours
 * with outcome='sent' and bucket by venue. We use rolling-24h instead of
 * "since midnight venue-local" because (a) it's a single query with no
 * timezone fan-out, and (b) the UI just wants a "throughput" indicator.
 *
 * The cron's actual cap enforcement uses the venue-local "today" boundary
 * via `evaluateSpendCap`, so this admin readout can be off by up to a day
 * boundary without affecting send behavior.
 */
async function fetchSentLast24h(venueIds: string[]): Promise<Map<string, number>> {
  if (venueIds.length === 0) return new Map();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('ai_runs')
    .select('venue_id')
    .in('venue_id', venueIds)
    .eq('outcome', 'sent')
    .gte('created_at', cutoff)
    .limit(50_000);

  if (error) {
    if (error.code !== '42P01') {
      console.error('[admin/ai-concierge] sent24h count error:', error.message);
    }
    return new Map();
  }

  const out = new Map<string, number>();
  for (const r of (data ?? []) as { venue_id: string }[]) {
    out.set(r.venue_id, (out.get(r.venue_id) ?? 0) + 1);
  }
  return out;
}
