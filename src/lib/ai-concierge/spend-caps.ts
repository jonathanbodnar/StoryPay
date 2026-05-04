/**
 * AI Concierge — per-venue daily SMS spend caps.
 *
 * Two concerns:
 *
 *   1. **Hard cap** — when a venue has sent its `effectiveCap` SMS for the
 *      day (counted as `ai_runs` rows with `outcome='sent'` since 00:00 in
 *      the venue's local timezone), the send cron defers any further leads
 *      to tomorrow's 9am venue-local. We log the deferral as a `cap_reached`
 *      run for the audit trail.
 *
 *   2. **Soft warning** — when a venue crosses the alert threshold (default
 *      80% of cap), we email the venue owner once per UTC day. The
 *      "once per day" guard is `venues.ai_alert_last_sent_at` so we don't
 *      spam, even across multiple cron ticks within the same day.
 *
 * Effective cap resolution:
 *   - `venues.ai_daily_send_cap` (per-venue override, NULL = use default)
 *   - else `ai_runtime_settings.default_daily_send_cap` (platform default,
 *     migration 100 sets the column default to 100)
 *
 * Cache: results are cached per-venue for 60s in module-level memory.
 * The send cron ticks every 10 minutes, and each tick is short-lived
 * (a single Node process), so 60s is generous enough to coalesce many
 * lead-level lookups within one tick while still reflecting "I just
 * raised the cap from the admin UI" within ~60s.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { formatInTimeZone } from 'date-fns-tz';
import { resolveVenueTimezone, wallClockToUtc } from '@/lib/venue-timezone';
import { getAiRuntimeSettings } from '@/lib/ai-concierge/runtime-settings';
import { notifyAiOwner } from '@/lib/ai-concierge/notifications';

const CACHE_TTL_MS = 60_000;
const HARD_MIN_CAP = 1;
const HARD_MAX_CAP = 100_000;

interface VenueCapRow {
  id:                            string;
  timezone:                      string | null;
  ai_daily_send_cap:             number | null;
  ai_daily_alert_threshold_pct:  number | null;
  ai_alert_last_sent_at:         string | null;
}

interface CacheEntry {
  venue:        VenueCapRow;
  effectiveCap: number;
  loadedAt:     number;
}

const cache = new Map<string, CacheEntry>();

// ── Public types ─────────────────────────────────────────────────────────

export interface SpendCapEvaluation {
  /** Today's count of `ai_runs` rows with outcome='sent' for this venue (in venue tz). */
  countToday:    number;
  /** Effective cap for the venue (per-venue override OR platform default). */
  effectiveCap:  number;
  /** True iff countToday >= effectiveCap. */
  capReached:    boolean;
  /** True iff countToday is at or above the alert threshold but below the cap. */
  atWarning:     boolean;
  /** Computed warning threshold: `floor(effectiveCap * threshold_pct / 100)`. */
  warningAt:     number;
  /** Threshold percentage actually applied (defaults to 80 if column missing/invalid). */
  thresholdPct:  number;
  /** Convenience: leads remaining for the day (max 0). */
  remaining:     number;
  /** Effective tz used for the "today" boundary. */
  timezone:      string;
  /** UTC ISO of midnight venue-local that started "today". */
  windowStartUtc: string;
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Evaluate current spend cap state for a venue. Returns counts + booleans
 * the caller (cron) can use to decide whether to skip + warn.
 */
export async function evaluateSpendCap(venueId: string): Promise<SpendCapEvaluation> {
  const entry = await loadCache(venueId);
  const venue = entry.venue;
  const tz    = resolveVenueTimezone(venue.timezone);

  // "Today" = since 00:00 venue-local.
  const localDate     = formatInTimeZone(new Date(), tz, 'yyyy-MM-dd');
  const startOfDayUtc = wallClockToUtc(localDate, '00:00', tz);

  const { count, error } = await supabaseAdmin
    .from('ai_runs')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', venueId)
    .eq('outcome',  'sent')
    .gte('created_at', startOfDayUtc.toISOString());

  if (error) {
    // Don't block sends on a counting failure. Treat as 0 sent — the worst
    // case is we send a few too many for one tick if Supabase blips.
    console.error('[ai-concierge] evaluateSpendCap count error:', error.message);
  }

  const countToday   = typeof count === 'number' ? count : 0;
  const cap          = entry.effectiveCap;
  const thresholdPct = clampThresholdPct(venue.ai_daily_alert_threshold_pct);
  const warningAt    = Math.floor(cap * (thresholdPct / 100));

  return {
    countToday,
    effectiveCap:   cap,
    capReached:     countToday >= cap,
    atWarning:      countToday >= warningAt && countToday < cap,
    warningAt,
    thresholdPct,
    remaining:      Math.max(0, cap - countToday),
    timezone:       tz,
    windowStartUtc: startOfDayUtc.toISOString(),
  };
}

/**
 * Returns just the effective cap for a venue (cached). Cheap to call
 * inside cron loops.
 */
export async function getEffectiveDailyCap(venueId: string): Promise<number> {
  const entry = await loadCache(venueId);
  return entry.effectiveCap;
}

/**
 * Best-effort: send a one-per-UTC-day warning email when the venue has
 * crossed the alert threshold. No-op if a warning was already sent today.
 *
 * Returns true iff an email was actually queued (i.e., this call was the
 * first warning of the day for this venue).
 */
export async function maybeSendCapWarningEmail(opts: {
  venueId:     string;
  evaluation:  SpendCapEvaluation;
  /** Optional override of the warning subject (e.g. "🚨 Daily AI cap reached"). */
  variant?:    'warning' | 'reached';
}): Promise<boolean> {
  const { venueId, evaluation } = opts;
  const variant = opts.variant ?? 'warning';

  // Only fire if we're meaningfully at threshold or above.
  if (variant === 'warning' && !evaluation.atWarning && !evaluation.capReached) return false;
  if (variant === 'reached' && !evaluation.capReached) return false;

  const entry = await loadCache(venueId, true);
  const venue = entry.venue;

  // Once per UTC day guard. We compare to NOW, not venue-tz today, so
  // venues that cross midnight in different timezones still get one email
  // per real day.
  const lastSent = venue.ai_alert_last_sent_at ? new Date(venue.ai_alert_last_sent_at) : null;
  if (lastSent && Date.now() - lastSent.getTime() < 24 * 60 * 60 * 1000) {
    // Already alerted within the last 24h — only re-send if we're escalating
    // from "warning" to "reached" (the second is more urgent and worth one
    // additional email).
    if (variant !== 'reached') return false;
    // For 'reached', allow re-send only if previous alert was a warning and
    // not also a "reached". We don't track that distinction in v1, so we
    // accept the trade-off of "at most one alert per day" — operators
    // can also see the live count in the admin panel.
    return false;
  }

  // Stamp first so we don't double-fire on a race.
  const stampNow = new Date().toISOString();
  await supabaseAdmin
    .from('venues')
    .update({ ai_alert_last_sent_at: stampNow })
    .eq('id', venueId);

  // Invalidate cache so subsequent calls see the new stamp.
  cache.delete(venueId);

  await notifyAiOwner({
    venueId,
    leadId:        venueId,  // not lead-specific; CTA points to the AI dashboard
    scenario:      variant === 'reached' ? 'ai_daily_cap_reached' : 'ai_daily_cap_warning',
    notifyRoles:   ['venue_owner'],
    brideName:     'Today\'s AI usage',
    brideFullName: 'Today\'s AI usage',
    extraDetail:   `${evaluation.countToday} of ${evaluation.effectiveCap} daily AI sends used (${Math.round((evaluation.countToday / evaluation.effectiveCap) * 100)}%).`,
  });

  return true;
}

/** Force the cache to refresh for a venue. Call after admin updates a cap. */
export function clearVenueSpendCache(venueId?: string): void {
  if (venueId) cache.delete(venueId);
  else         cache.clear();
}

// ── Internals ────────────────────────────────────────────────────────────

async function loadCache(venueId: string, force = false): Promise<CacheEntry> {
  const existing = cache.get(venueId);
  if (!force && existing && Date.now() - existing.loadedAt < CACHE_TTL_MS) {
    return existing;
  }

  const { data, error } = await supabaseAdmin
    .from('venues')
    .select('id, timezone, ai_daily_send_cap, ai_daily_alert_threshold_pct, ai_alert_last_sent_at')
    .eq('id', venueId)
    .maybeSingle();

  if (error || !data) {
    // Pre-migration-100 fallback OR venue missing. Use a defensive default
    // (don't crash sends).
    const fallback: CacheEntry = {
      venue: {
        id:                           venueId,
        timezone:                     null,
        ai_daily_send_cap:            null,
        ai_daily_alert_threshold_pct: 80,
        ai_alert_last_sent_at:        null,
      },
      effectiveCap: await readPlatformDefault(),
      loadedAt:     Date.now(),
    };
    cache.set(venueId, fallback);
    return fallback;
  }

  const venue = data as VenueCapRow;
  const perVenueCap = venue.ai_daily_send_cap;
  const cap = (typeof perVenueCap === 'number' && perVenueCap >= HARD_MIN_CAP && perVenueCap <= HARD_MAX_CAP)
    ? perVenueCap
    : await readPlatformDefault();

  const entry: CacheEntry = { venue, effectiveCap: cap, loadedAt: Date.now() };
  cache.set(venueId, entry);
  return entry;
}

async function readPlatformDefault(): Promise<number> {
  const settings = await getAiRuntimeSettings();
  const cap = settings.defaultDailySendCap;
  if (typeof cap !== 'number' || cap < HARD_MIN_CAP) return 100;
  return Math.min(cap, HARD_MAX_CAP);
}

function clampThresholdPct(raw: number | null | undefined): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 80;
  return Math.max(1, Math.min(100, Math.floor(raw)));
}
