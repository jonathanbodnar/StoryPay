/**
 * AI Concierge — activation cron.
 *
 * Runs hourly (see `src/app/api/cron/ai-activate/route.ts`). Two activation
 * paths share this entry point:
 *
 *   1. First-time activation
 *      - Lead is `ai_state='dormant'`, never replied (`last_inbound_at IS NULL`),
 *        and got an outbound automation email more than 14 days ago.
 *      - On activation: ai_first_activated_at = NOW(), ai_expires_at = NOW()+60d,
 *        next send queued for the upcoming send-window (quiet-hours-aware).
 *
 *   2. Manual re-enable (after 24-hour cooldown elapsed)
 *      - A human pressed "Re-enable AI" on a contact whose state had moved to
 *        paused / handoff / opted_out / exhausted. The button reset state to
 *        'dormant' and set `ai_next_send_at = NOW() + 24h` and
 *        `ai_re_enabled_at = NOW()`. The cooldown has now elapsed.
 *      - On activation: ai_first_activated_at and ai_expires_at are PRESERVED
 *        (60-day cap is global, no resets). Just flip back to ai_active and
 *        let the send cron pick it up on the next quiet-hours-allowed tick.
 *
 * Eligibility filters apply in BOTH paths:
 *   - venues.ai_concierge_enabled = TRUE
 *   - venues.directory_addon_concierge = TRUE
 *   - venues.a2p_verified = TRUE
 *   - leads.sms_dnd = FALSE
 *
 * For each eligible row we run an idempotent UPDATE that re-checks the entire
 * eligibility predicate, so two concurrent cron ticks can't double-activate a
 * lead. Pipeline-stage move + tag application are best-effort: if they fail
 * the lead still ends up in `ai_active` and the send cron will keep moving.
 */

import type postgres from 'postgres';

import { getDbAsync } from '@/lib/db';
import { resolveVenueTimezone } from '@/lib/venue-timezone';

import { ensureVenueAiResources } from './venue-resources';
import { moveLeadToAiStage, applyAiTag } from './pipeline-tag-service';
import { recordAiStateTransition } from './state-transitions';
import { enforceQuietHours } from './quiet-hours';
import { getAiRuntimeSettings, stampCronHeartbeat } from './runtime-settings';

// ── Public types ───────────────────────────────────────────────────────────

export interface RunActivationCronOptions {
  /** Soft cap on leads activated in a single tick. Default 500. */
  maxLeads?: number;
  /** Set this to skip eligibility filters (for super-admin debug runs). */
  bypassEligibility?: boolean;
}

export interface ActivationCronResult {
  ok:           true;
  scanned:      number;
  activated:    number;
  reEnabled:    number;
  skipped:      number;
  errors:       Array<{ leadId: string; error: string }>;
  durationMs:   number;
  startedAt:    string;
  finishedAt:   string;
  /** When true, the global kill switch was on and the cron exited immediately. */
  killSwitchEngaged?: boolean;
  /** Reason recorded with the kill switch (operator-supplied), if any. */
  killSwitchReason?:  string | null;
}

// ── Internal row shape from the eligibility query ──────────────────────────

interface EligibleLeadRow {
  id:                       string;
  venue_id:                 string;
  ai_first_activated_at:    Date | null;
  ai_re_enabled_at:         Date | null;
  ai_next_send_at:          Date | null;
  timezone:                 string | null;
}

interface UpdateActivationRow {
  id:                       string;
  ai_first_activated_at:    Date;
  ai_expires_at:            Date;
  ai_next_send_at:          Date;
}

// ── Main entry ─────────────────────────────────────────────────────────────

export async function runAiActivationCron(
  opts: RunActivationCronOptions = {},
): Promise<ActivationCronResult> {
  const startedAt = new Date();
  const maxLeads = opts.maxLeads ?? 500;

  // Global kill switch — exit immediately, log reason. We don't even open a
  // DB connection past this point so the operator's "stop everything" lever
  // really does stop everything cheaply.
  const runtime = await getAiRuntimeSettings();
  if (runtime.killSwitchEnabled) {
    const finishedAt = new Date();
    return {
      ok:                true,
      scanned:           0,
      activated:         0,
      reEnabled:         0,
      skipped:           0,
      errors:            [],
      durationMs:        finishedAt.getTime() - startedAt.getTime(),
      startedAt:         startedAt.toISOString(),
      finishedAt:        finishedAt.toISOString(),
      killSwitchEngaged: true,
      killSwitchReason:  runtime.killSwitchReason,
    };
  }

  const sql = await getDbAsync();

  const eligible = await fetchEligibleLeads(sql, maxLeads, !!opts.bypassEligibility);

  let activated = 0;
  let reEnabled = 0;
  let skipped   = 0;
  const errors: Array<{ leadId: string; error: string }> = [];

  for (const row of eligible) {
    try {
      const tz = resolveVenueTimezone(row.timezone);
      const nextSend = enforceQuietHours(new Date(), tz);
      const isReEnable = row.ai_first_activated_at !== null;

      const updated = await activateLead(sql, row, nextSend, opts.bypassEligibility ?? false);
      if (!updated) {
        skipped += 1;
        continue;
      }

      // Make sure resources are resolved before the stage / tag move
      await ensureVenueAiResources(row.venue_id);

      // Best-effort: stage + tag (failures logged inside, never thrown)
      await moveLeadToAiStage(row.venue_id, row.id, 'followup');
      await applyAiTag(row.venue_id, row.id, 'ai_active');

      await recordAiStateTransition({
        leadId:      row.id,
        venueId:     row.venue_id,
        fromState:   'dormant',
        toState:     'ai_active',
        reason:      isReEnable ? 'manually_re_enabled' : 'first_activation',
        triggeredBy: 'cron:ai-activate',
        metadata: {
          ai_next_send_at:       updated.ai_next_send_at.toISOString(),
          ai_first_activated_at: updated.ai_first_activated_at.toISOString(),
          ai_expires_at:         updated.ai_expires_at.toISOString(),
          venue_timezone:        tz,
        },
      });

      if (isReEnable) reEnabled += 1; else activated += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown error';
      console.error(`[ai-activate] lead ${row.id}: ${msg}`);
      errors.push({ leadId: row.id, error: msg });
    }
  }

  // Stamp heartbeat at end of a successful run so the admin dashboard
  // can surface a green/red liveness badge. Best-effort — never throws.
  await stampCronHeartbeat('activation');

  const finishedAt = new Date();
  return {
    ok:        true,
    scanned:   eligible.length,
    activated,
    reEnabled,
    skipped,
    errors,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  };
}

// ── Eligibility query ──────────────────────────────────────────────────────

/**
 * Find dormant leads whose AI follow-up is due to start (or restart after
 * the 24-hour re-enable cooldown).
 *
 * The AI Concierge is venue-level: if the venue has it enabled and the lead
 * has been silent for 14 days, AI activates. Workflow enrollment is
 * irrelevant — the AI's only job is to re-engage silent leads and fire a
 * notification the moment they reply. Workflow automations handle everything
 * else (sequences, content delivery, etc.) independently.
 */
async function fetchEligibleLeads(
  sql: postgres.Sql,
  limit: number,
  bypassEligibility: boolean,
): Promise<EligibleLeadRow[]> {
  const venueGuard = bypassEligibility
    ? sql`TRUE`
    : sql`
        COALESCE(v.ai_concierge_enabled, false) = true
        AND COALESCE(v.directory_addon_concierge, false) = true
        AND COALESCE(v.a2p_verified, false) = true
      `;

  const rows = await sql<EligibleLeadRow[]>`
    SELECT
      l.id,
      l.venue_id,
      l.ai_first_activated_at,
      l.ai_re_enabled_at,
      l.ai_next_send_at,
      v.timezone
    FROM public.leads l
    JOIN public.venues v ON v.id = l.venue_id
    WHERE l.ai_state = 'dormant'
      AND COALESCE(l.sms_dnd, false) = false
      AND ${venueGuard}
      AND (
        -- First-time path: outbound went out 14+ days ago, no inbound yet
        (l.ai_first_activated_at IS NULL
          AND l.last_inbound_at IS NULL
          AND l.last_outbound_at IS NOT NULL
          AND l.last_outbound_at < NOW() - INTERVAL '14 days')
        OR
        -- Re-enable path: 24h cooldown has elapsed
        (l.ai_re_enabled_at IS NOT NULL
          AND l.ai_next_send_at IS NOT NULL
          AND l.ai_next_send_at <= NOW())
      )
    ORDER BY COALESCE(l.ai_re_enabled_at, l.last_outbound_at) ASC
    LIMIT ${limit}
  `;

  return rows;
}

// ── Atomic activation update ───────────────────────────────────────────────

/**
 * Idempotent activation update. Re-checks the entire eligibility predicate
 * inside the WHERE clause so concurrent ticks (or a race against an inbound
 * webhook flipping the lead out of dormant) can't double-activate.
 *
 * Returns the new row on success, or `null` if the lead was no longer
 * eligible at the moment of update.
 */
async function activateLead(
  sql: postgres.Sql,
  row: EligibleLeadRow,
  nextSendAt: Date,
  bypassEligibility: boolean,
): Promise<UpdateActivationRow | null> {
  const venueGuardSubquery = bypassEligibility
    ? sql`TRUE`
    : sql`
        EXISTS (
          SELECT 1 FROM public.venues v
          WHERE v.id = leads.venue_id
            AND COALESCE(v.ai_concierge_enabled, false) = true
            AND COALESCE(v.directory_addon_concierge, false) = true
            AND COALESCE(v.a2p_verified, false) = true
        )
      `;

  const updated = await sql<UpdateActivationRow[]>`
    UPDATE public.leads
       SET ai_state              = 'ai_active',
           ai_first_activated_at = COALESCE(ai_first_activated_at, NOW()),
           ai_expires_at         = COALESCE(ai_expires_at, NOW() + INTERVAL '60 days'),
           ai_next_send_at       = ${nextSendAt.toISOString()},
           updated_at            = NOW()
     WHERE id = ${row.id}
       AND ai_state = 'dormant'
       AND COALESCE(sms_dnd, false) = false
       AND ${venueGuardSubquery}
       AND (
         (ai_first_activated_at IS NULL
           AND last_inbound_at IS NULL
           AND last_outbound_at IS NOT NULL
           AND last_outbound_at < NOW() - INTERVAL '14 days')
         OR
         (ai_re_enabled_at IS NOT NULL
           AND ai_next_send_at IS NOT NULL
           AND ai_next_send_at <= NOW())
       )
     RETURNING id, ai_first_activated_at, ai_expires_at, ai_next_send_at
  `;

  return updated[0] ?? null;
}
