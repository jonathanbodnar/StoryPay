-- ============================================================================
-- Migration 100 — AI Concierge A2P verification cache + per-venue spend caps
-- ----------------------------------------------------------------------------
-- Closes two big v1 gaps for AI Concierge:
--
--   1. **A2P verification automation** (formerly a manual super-admin flip).
--      We now cache the GoHighLevel A2P brand + campaign IDs and statuses on
--      the venue row, plus the timestamp of the last successful pull and
--      the most recent error (if any). When both brand AND campaign show
--      "approved" / "verified" status, we auto-set venues.a2p_verified=TRUE.
--      When they don't, we auto-set it back to FALSE — which (combined with
--      the eligibility CHECK constraint) automatically disables AI for any
--      venue whose A2P registration lapses.
--
--   2. **Per-venue spend caps** (formerly unbounded, runaway risk).
--      Each venue gets a daily SMS send cap (NULL = use platform default).
--      The send cron consults the cap before processing each lead and
--      reschedules over-cap leads to tomorrow's morning quiet-hours window.
--      Operators get a one-per-day warning email when crossing a configurable
--      threshold (default 80% of cap), avoiding alert spam.
--
-- The platform-wide default cap lives on ai_runtime_settings (the same
-- singleton row that holds the kill switch).
--
-- Idempotent: safe to re-run. Uses ADD COLUMN IF NOT EXISTS guards
-- throughout.
-- ============================================================================

-- ── 1. venues — A2P verification cache ────────────────────────────────────
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS a2p_brand_id           TEXT,
  ADD COLUMN IF NOT EXISTS a2p_brand_status       TEXT,
  ADD COLUMN IF NOT EXISTS a2p_campaign_id        TEXT,
  ADD COLUMN IF NOT EXISTS a2p_campaign_status    TEXT,
  ADD COLUMN IF NOT EXISTS a2p_last_checked_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS a2p_last_check_error   TEXT;

-- ── 2. venues — per-venue daily send cap ──────────────────────────────────
ALTER TABLE public.venues
  -- NULL = use platform default. Non-null overrides at the venue level.
  ADD COLUMN IF NOT EXISTS ai_daily_send_cap            INTEGER,
  -- Warn-by-email threshold as a percentage of the effective cap. 80% means
  -- the operator gets a heads-up email when the venue has used 80% of today's
  -- budget. 100 (or higher) silences the warning email entirely.
  ADD COLUMN IF NOT EXISTS ai_daily_alert_threshold_pct INTEGER NOT NULL DEFAULT 80,
  -- Last time we sent the warning email for this venue. Used to ensure at
  -- most one warning per UTC day.
  ADD COLUMN IF NOT EXISTS ai_alert_last_sent_at        TIMESTAMPTZ;

-- ── 3. ai_runtime_settings — platform-default cap ─────────────────────────
-- 100 sends/day/venue is a defensible starting default — at the random
-- 1-3 day cadence, a venue would have to be sending to ~200-300 active
-- AI leads before brushing this cap. Operators can raise it from the UI.
ALTER TABLE public.ai_runtime_settings
  ADD COLUMN IF NOT EXISTS default_daily_send_cap INTEGER NOT NULL DEFAULT 100;

-- ── 4. Helpful indexes ────────────────────────────────────────────────────
-- The send cron's daily-count query filters by venue_id + outcome + window.
-- The existing ai_runs_venue_created_idx already covers (venue_id, created_at)
-- so the count query uses that index. No new index needed for v1.

-- Refresh PostgREST schema cache so the new columns are queryable.
NOTIFY pgrst, 'reload schema';
