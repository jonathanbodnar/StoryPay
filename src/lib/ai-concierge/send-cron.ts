/**
 * AI Concierge — send cron.
 *
 * Runs every ~10 minutes. For each lead in `ai_state='ai_active'` whose
 * `ai_next_send_at <= NOW()`:
 *
 *   1. Reservation lock — atomic UPDATE bumps ai_next_send_at to NOW()+15min
 *      to prevent a concurrent tick from picking up the same lead. If the
 *      reservation update returns 0 rows, another tick claimed it; skip.
 *
 *   2. Expiration check — if NOW() > ai_expires_at (60-day cap from first
 *      activation), transition to 'exhausted', apply ai_exhausted tag, move
 *      to 'not_interested' stage, log transition, return.
 *
 *   3. Quiet hours check — defense-in-depth. enforceQuietHours should have
 *      taken care of this at scheduling time, but if the local clock has
 *      drifted into quiet hours, push next_send to the next 9am and skip.
 *
 *   4. Build prompt — pull the active ai_config, venue + lead context, last
 *      10 messages, and render the system prompt template.
 *
 *   5. Generate — call DeepSeek, parse the <<angle>> + <<sms>> structured
 *      output. Clamp to ≤320 characters.
 *
 *   6. Persist BEFORE sending — insert the conversation_messages row first
 *      (sender_kind='ai', channel='sms', visibility='external'). This makes
 *      double-sends impossible if the SMS provider returns "sent" but the
 *      next DB write fails. We also rely on the message row being present
 *      so the inbox UI shows the message even if the bride replies before
 *      the next cron tick.
 *
 *   7. Send via the SMS provider factory. On success: stamp the provider
 *      message id onto the conversation_messages row, increment attempt
 *      counter, append the angle to ai_angles_used, schedule next send via
 *      enforceQuietHours(NOW() + random(1..3) days), log to ai_runs.
 *
 *   8. On send failure: classify the outcome. transient_error / auth_error
 *      schedule a retry in 30 min (no attempt counter bump). dnd /
 *      invalid_phone / permanent_error transition the lead to 'opted_out'
 *      since further sends are pointless. All paths log to ai_runs.
 *
 * Failures of any non-critical sub-step (stage move, tag apply) are logged
 * but never thrown — the AI engine is resilient by design.
 */

import type postgres from 'postgres';

import { getDbAsync } from '@/lib/db';
import { supabaseAdmin } from '@/lib/supabase';
import { resolveVenueTimezone } from '@/lib/venue-timezone';

import { ensureVenueAiResources } from './venue-resources';
import { moveLeadToAiStage, applyAiTag, removeAiTag } from './pipeline-tag-service';
import { recordAiStateTransition } from './state-transitions';
import { enforceQuietHours, isInsideQuietHours } from './quiet-hours';
import { buildAiConciergeSystemPrompt } from './prompt-builder';
import { generateSmsWithDeepSeek, clampSmsLength } from './llm';
import { logAiOutboundMessage } from './conversation-helpers';
import { sendAiSms } from './sms-provider';
import { getAiRuntimeSettings } from './runtime-settings';
import { evaluateSpendCap, maybeSendCapWarningEmail } from './spend-caps';
import { wallClockToUtc, addCalendarDaysYmd } from '@/lib/venue-timezone';
import { formatInTimeZone } from 'date-fns-tz';

import type { AiAngleKey } from './types';
import type { SmsSendOutcome } from './sms-provider/types';

// ── Public types ───────────────────────────────────────────────────────────

export interface RunSendCronOptions {
  /** Soft cap on leads processed in a single tick. Default 200. */
  maxLeads?: number;
  /** Reservation window: how long the lead is locked while we generate+send.
   *  Default 15 minutes; bump if DeepSeek is slow. */
  reservationMinutes?: number;
}

export interface SendCronResult {
  ok:          true;
  scanned:     number;
  sent:        number;
  expired:     number;
  retried:     number;
  optedOut:    number;
  errors:      Array<{ leadId: string; error: string; outcome?: string }>;
  durationMs:  number;
  startedAt:   string;
  finishedAt:  string;
  /** When true, the global kill switch was on and the cron exited immediately. */
  killSwitchEngaged?: boolean;
  killSwitchReason?:  string | null;
}

interface ReservedLeadRow {
  id:                       string;
  venue_id:                 string;
  ai_first_activated_at:    Date | null;
  ai_expires_at:            Date | null;
  ai_attempt_count:         number;
  ai_angles_used:           string[];
  timezone:                 string | null;
  ai_assistant_persona_name: string | null;
}

// ── Main entry ─────────────────────────────────────────────────────────────

export async function runAiSendCron(
  opts: RunSendCronOptions = {},
): Promise<SendCronResult> {
  const startedAt = new Date();
  const maxLeads  = opts.maxLeads ?? 200;
  const reservMin = opts.reservationMinutes ?? 15;

  // Global kill switch — exit before reserving anything. Leads stay in their
  // current state with their existing ai_next_send_at; once the switch is
  // released the next send-cron tick picks them up where they left off.
  const runtime = await getAiRuntimeSettings();
  if (runtime.killSwitchEnabled) {
    const finishedAt = new Date();
    return {
      ok:                true,
      scanned:           0,
      sent:              0,
      expired:           0,
      retried:           0,
      optedOut:          0,
      errors:            [],
      durationMs:        finishedAt.getTime() - startedAt.getTime(),
      startedAt:         startedAt.toISOString(),
      finishedAt:        finishedAt.toISOString(),
      killSwitchEngaged: true,
      killSwitchReason:  runtime.killSwitchReason,
    };
  }

  const sql = await getDbAsync();

  // 1. Reserve leads
  const reserved = await reserveDueLeads(sql, maxLeads, reservMin);

  let sent     = 0;
  let expired  = 0;
  let retried  = 0;
  let optedOut = 0;
  const errors: Array<{ leadId: string; error: string; outcome?: string }> = [];

  for (const row of reserved) {
    try {
      const result = await processOneLead(sql, row);
      switch (result.kind) {
        case 'sent':       sent     += 1; break;
        case 'expired':    expired  += 1; break;
        case 'retry':      retried  += 1; break;
        case 'opted_out':  optedOut += 1; break;
        case 'skipped':    /* no counter — logged via ai_runs */ break;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown error';
      console.error(`[ai-send] lead ${row.id}: ${msg}`);
      errors.push({ leadId: row.id, error: msg });
    }
  }

  const finishedAt = new Date();
  return {
    ok:        true,
    scanned:   reserved.length,
    sent,
    expired,
    retried,
    optedOut,
    errors,
    startedAt:  startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  };
}

// ── Reservation ────────────────────────────────────────────────────────────

/**
 * Atomically reserve a batch of due leads by bumping `ai_next_send_at` forward
 * by `reservMin` minutes. Concurrent ticks pick up disjoint sets because the
 * UPDATE re-checks `ai_next_send_at <= NOW()`.
 *
 * Why this rather than `FOR UPDATE SKIP LOCKED`:
 *   - We're using postgres.js without explicit transactions, and the cron may
 *     take many seconds per lead while DeepSeek generates copy. Holding a row
 *     lock that long is a bad idea.
 *   - Bumping the timestamp is durable across crashes — if we die mid-send the
 *     lead naturally retries in `reservMin` minutes.
 */
async function reserveDueLeads(
  sql: postgres.Sql,
  limit: number,
  reservMin: number,
): Promise<ReservedLeadRow[]> {
  const rows = await sql<ReservedLeadRow[]>`
    UPDATE public.leads l
       SET ai_next_send_at = NOW() + (${reservMin} || ' minutes')::interval,
           updated_at      = NOW()
      FROM public.venues v
     WHERE l.id IN (
        SELECT l2.id
          FROM public.leads l2
          JOIN public.venues v2 ON v2.id = l2.venue_id
         WHERE l2.ai_state = 'ai_active'
           AND l2.ai_next_send_at IS NOT NULL
           AND l2.ai_next_send_at <= NOW()
           AND COALESCE(l2.sms_dnd, false) = false
           AND COALESCE(v2.ai_concierge_enabled, false) = true
           AND COALESCE(v2.directory_addon_concierge, false) = true
           AND COALESCE(v2.a2p_verified, false) = true
         ORDER BY l2.ai_next_send_at ASC
         LIMIT ${limit}
       )
       AND v.id = l.venue_id
       AND l.ai_state = 'ai_active'
       AND l.ai_next_send_at <= NOW() + (${reservMin} || ' minutes')::interval
    RETURNING
      l.id,
      l.venue_id,
      l.ai_first_activated_at,
      l.ai_expires_at,
      l.ai_attempt_count,
      l.ai_angles_used,
      v.timezone,
      v.ai_assistant_persona_name
  `;
  return rows;
}

// ── Per-lead processor ─────────────────────────────────────────────────────

type LeadResult =
  | { kind: 'sent' }
  | { kind: 'expired' }
  | { kind: 'retry'; reason: string }
  | { kind: 'opted_out'; reason: string }
  | { kind: 'skipped'; reason: string };

async function processOneLead(
  sql: postgres.Sql,
  row: ReservedLeadRow,
): Promise<LeadResult> {
  const tz = resolveVenueTimezone(row.timezone);

  // 2. Expiration check (60-day hard cap)
  if (row.ai_expires_at && row.ai_expires_at.getTime() <= Date.now()) {
    await markExhausted(row);
    return { kind: 'expired' };
  }

  // 3. Quiet hours guard
  if (isInsideQuietHours(new Date(), tz)) {
    const nextWindow = enforceQuietHours(new Date(), tz);
    await rescheduleLead(row.id, nextWindow);
    await logAiRun({
      leadId:    row.id,
      venueId:   row.venue_id,
      attempt:   row.ai_attempt_count + 1,
      outcome:   'skipped_quiet_hours',
      detail:    `Inside quiet hours; rescheduled to ${nextWindow.toISOString()}`,
    });
    return { kind: 'skipped', reason: 'quiet_hours' };
  }

  // 3.5. Per-venue daily spend cap. Cheaper than building a prompt + calling
  // DeepSeek + sending SMS, so we check before any of that work.
  const spend = await evaluateSpendCap(row.venue_id);
  if (spend.capReached) {
    // Defer to tomorrow's morning send window in venue tz.
    const tomorrowMorning = nextMorningInVenueTz(tz);
    await rescheduleLead(row.id, tomorrowMorning);
    await logAiRun({
      leadId:  row.id,
      venueId: row.venue_id,
      attempt: row.ai_attempt_count + 1,
      outcome: 'skipped_cap_reached',
      detail:  `Daily cap reached (${spend.countToday}/${spend.effectiveCap}); rescheduled to ${tomorrowMorning.toISOString()}`,
    });
    // Best-effort one-per-day "you hit the cap" email. The threshold-only
    // warning email is fired below, on the first send that crosses 80%.
    void maybeSendCapWarningEmail({ venueId: row.venue_id, evaluation: spend, variant: 'reached' })
      .catch((e) => console.error('[ai-send] cap-reached email failed:', e));
    return { kind: 'skipped', reason: 'cap_reached' };
  }
  // Soft warning (no behavior change, just an email). We fire this BEFORE the
  // send so the operator knows usage is climbing; the email itself is
  // throttled to once per UTC day inside `maybeSendCapWarningEmail`.
  if (spend.atWarning) {
    void maybeSendCapWarningEmail({ venueId: row.venue_id, evaluation: spend, variant: 'warning' })
      .catch((e) => console.error('[ai-send] cap-warning email failed:', e));
  }

  // 4. Build prompt
  const angleHistory: AiAngleKey[] = (row.ai_angles_used || [])
    .filter((a): a is AiAngleKey => typeof a === 'string' && a.length > 0)
    .map((a) => a as AiAngleKey);

  const prompt = await buildAiConciergeSystemPrompt({
    venueId:       row.venue_id,
    leadId:        row.id,
    attemptNumber: row.ai_attempt_count + 1,
    anglesUsed:    angleHistory,
  });

  if (!('ok' in prompt) || !prompt.ok) {
    const detail = ('error' in prompt) ? prompt.error : 'unknown prompt error';
    await rescheduleLead(row.id, new Date(Date.now() + 30 * 60 * 1000));
    await logAiRun({
      leadId:  row.id,
      venueId: row.venue_id,
      attempt: row.ai_attempt_count + 1,
      outcome: 'prompt_error',
      detail,
    });
    return { kind: 'retry', reason: detail };
  }

  // 5. Generate via DeepSeek
  const gen = await generateSmsWithDeepSeek({ systemPrompt: prompt.systemPrompt });
  if (!gen.ok) {
    await rescheduleLead(row.id, new Date(Date.now() + 30 * 60 * 1000));
    await logAiRun({
      leadId:        row.id,
      venueId:       row.venue_id,
      attempt:       row.ai_attempt_count + 1,
      configVersion: prompt.config.version,
      systemPrompt:  prompt.systemPrompt,
      outcome:       `llm_${gen.error}`,
      detail:        gen.detail,
      modelOutput:   gen.rawModelOutput ?? null,
      inputContext:  prompt.inputContext,
    });
    return { kind: 'retry', reason: gen.error };
  }

  const constraints = prompt.config.message_constraints as { max_chars?: number } | null;
  const maxChars = (constraints && typeof constraints.max_chars === 'number') ? constraints.max_chars : 320;
  const finalText = clampSmsLength(gen.smsText, maxChars);

  // 6. Persist message FIRST (before sending) — provider id will be stamped after send
  const logged = await logAiOutboundMessage({
    venueId: row.venue_id,
    leadId:  row.id,
    body:    finalText,
  });

  // 7. Send
  const sendResult = await sendAiSms({
    venueId: row.venue_id,
    leadId:  row.id,
    message: finalText,
  });

  // 8. Post-send branching
  if (sendResult.ok) {
    if (logged.messageId && sendResult.providerMessageId) {
      try {
        await supabaseAdmin
          .from('conversation_messages')
          .update({ ghl_message_id: sendResult.providerMessageId, external_email_sent: true })
          .eq('id', logged.messageId);
      } catch (e) {
        console.error('[ai-send] failed to stamp provider message id:', e);
      }
    }

    const nextSendAt = computeNextSendAt(tz);
    const newAngles  = appendAngle(angleHistory, gen.angle);

    await sql`
      UPDATE public.leads
         SET ai_attempt_count = COALESCE(ai_attempt_count, 0) + 1,
             ai_angles_used   = ${newAngles}::text[],
             ai_next_send_at  = ${nextSendAt.toISOString()},
             updated_at       = NOW()
       WHERE id = ${row.id}
    `;

    await logAiRun({
      leadId:           row.id,
      venueId:          row.venue_id,
      attempt:          row.ai_attempt_count + 1,
      configVersion:    prompt.config.version,
      systemPrompt:     prompt.systemPrompt,
      modelOutput:      gen.rawModelOutput,
      finalSentText:    finalText,
      angle:            gen.angle,
      smsProvider:      sendResult.providerKey,
      providerMsgId:    sendResult.providerMessageId,
      outcome:          'sent',
      inputContext:     prompt.inputContext,
    });
    return { kind: 'sent' };
  }

  // Send failed — classify outcome
  const failure = sendResult.outcome;
  const detail  = sendResult.error || 'unknown send error';

  // Mark the conversation_messages row as failed-to-send if we logged one
  if (logged.messageId) {
    try {
      await supabaseAdmin
        .from('conversation_messages')
        .update({ external_email_sent: false, send_error: detail.slice(0, 500) })
        .eq('id', logged.messageId);
    } catch { /* non-fatal */ }
  }

  await logAiRun({
    leadId:        row.id,
    venueId:       row.venue_id,
    attempt:       row.ai_attempt_count + 1,
    configVersion: prompt.config.version,
    systemPrompt:  prompt.systemPrompt,
    modelOutput:   gen.rawModelOutput,
    finalSentText: finalText,
    angle:         gen.angle,
    smsProvider:   sendResult.providerKey,
    outcome:       `send_${failure}`,
    detail,
    inputContext:  prompt.inputContext,
  });

  if (isUnsendableOutcome(failure)) {
    await markOptedOut(row, failure, detail);
    return { kind: 'opted_out', reason: failure };
  }

  // Transient / auth error — retry in 30 min, no attempt counter bump
  await rescheduleLead(row.id, new Date(Date.now() + 30 * 60 * 1000));
  return { kind: 'retry', reason: failure };
}

// ── Post-process helpers ───────────────────────────────────────────────────

function isUnsendableOutcome(outcome: SmsSendOutcome): boolean {
  return outcome === 'invalid_phone' || outcome === 'dnd' || outcome === 'permanent_error';
}

async function rescheduleLead(leadId: string, nextSendAt: Date): Promise<void> {
  try {
    await supabaseAdmin
      .from('leads')
      .update({
        ai_next_send_at: nextSendAt.toISOString(),
        updated_at:      new Date().toISOString(),
      })
      .eq('id', leadId);
  } catch (e) {
    console.error('[ai-send] rescheduleLead failed:', e);
  }
}

async function markExhausted(row: ReservedLeadRow): Promise<void> {
  try {
    await supabaseAdmin
      .from('leads')
      .update({
        ai_state:        'exhausted',
        ai_next_send_at: null,
        updated_at:      new Date().toISOString(),
      })
      .eq('id', row.id);

    await ensureVenueAiResources(row.venue_id);
    await applyAiTag(row.venue_id, row.id, 'ai_exhausted');
    await removeAiTag(row.venue_id, row.id, 'ai_active');
    await moveLeadToAiStage(row.venue_id, row.id, 'not_interested');

    await recordAiStateTransition({
      leadId:      row.id,
      venueId:     row.venue_id,
      fromState:   'ai_active',
      toState:     'exhausted',
      reason:      'expired_60_days',
      triggeredBy: 'cron:ai-send',
      metadata: {
        ai_first_activated_at: row.ai_first_activated_at?.toISOString() ?? null,
        ai_expires_at:         row.ai_expires_at?.toISOString() ?? null,
        attempt_count:         row.ai_attempt_count,
      },
    });
  } catch (e) {
    console.error('[ai-send] markExhausted failed:', e);
  }
}

async function markOptedOut(
  row: ReservedLeadRow,
  outcome: SmsSendOutcome,
  detail: string,
): Promise<void> {
  try {
    await supabaseAdmin
      .from('leads')
      .update({
        ai_state:        'opted_out',
        ai_next_send_at: null,
        sms_dnd:         outcome === 'dnd' ? true : undefined,
        updated_at:      new Date().toISOString(),
      })
      .eq('id', row.id);

    await ensureVenueAiResources(row.venue_id);
    await applyAiTag(row.venue_id, row.id, 'ai_not_interested');
    await removeAiTag(row.venue_id, row.id, 'ai_active');
    await moveLeadToAiStage(row.venue_id, row.id, 'not_interested');

    await recordAiStateTransition({
      leadId:      row.id,
      venueId:     row.venue_id,
      fromState:   'ai_active',
      toState:     'opted_out',
      reason:      outcome === 'dnd' ? 'inbound_tcpa_opt_out' : 'admin_force_reset',
      triggeredBy: 'cron:ai-send',
      metadata:    { send_outcome: outcome, detail: detail.slice(0, 500) },
    });
  } catch (e) {
    console.error('[ai-send] markOptedOut failed:', e);
  }
}

/**
 * Tomorrow at 9am in the venue's local timezone, expressed as UTC. Used
 * when a venue hits its daily SMS cap — we defer all further leads from
 * today's batch to that exact instant so the cron picks them up first
 * thing in the morning.
 */
function nextMorningInVenueTz(timezone: string): Date {
  const todayLocalYmd = formatInTimeZone(new Date(), timezone, 'yyyy-MM-dd');
  const tomorrowYmd   = addCalendarDaysYmd(todayLocalYmd, 1, timezone);
  return wallClockToUtc(tomorrowYmd, '09:00', timezone);
}

/**
 * Compute the next send time: random between 24 and 72 hours from now,
 * pushed into the venue-local 9am–8pm window if it lands outside.
 */
function computeNextSendAt(timezone: string): Date {
  const minMs = 24 * 60 * 60 * 1000;
  const maxMs = 72 * 60 * 60 * 1000;
  const offset = minMs + Math.floor(Math.random() * (maxMs - minMs));
  const naive  = new Date(Date.now() + offset);
  return enforceQuietHours(naive, timezone);
}

function appendAngle(used: AiAngleKey[], angle: AiAngleKey): AiAngleKey[] {
  // Cap at 50 entries — long-term we just need to avoid recent duplicates
  const merged = [...used, angle];
  return merged.length > 50 ? merged.slice(-50) : merged;
}

// ── ai_runs logger ─────────────────────────────────────────────────────────

interface AiRunLogInput {
  leadId:         string;
  venueId:        string;
  attempt?:       number;
  configVersion?: number;
  systemPrompt?:  string;
  modelOutput?:   string | null;
  finalSentText?: string;
  angle?:         string;
  smsProvider?:   string;
  providerMsgId?: string;
  outcome:        string;
  detail?:        string;
  inputContext?:  unknown;
}

async function logAiRun(input: AiRunLogInput): Promise<void> {
  try {
    await supabaseAdmin.from('ai_runs').insert({
      lead_id:             input.leadId,
      venue_id:            input.venueId,
      ai_config_version:   input.configVersion ?? null,
      attempt_number:      input.attempt ?? null,
      input_context:       input.inputContext ?? null,
      system_prompt:       input.systemPrompt ?? null,
      model_output:        input.modelOutput ?? null,
      final_sent_text:     input.finalSentText ?? null,
      angle_used:          input.angle ?? null,
      sms_provider:        input.smsProvider ?? null,
      provider_message_id: input.providerMsgId ?? null,
      outcome:             input.outcome,
      error_detail:        input.detail ?? null,
    });
  } catch (e) {
    console.error('[ai-send] logAiRun insert failed:', e);
  }
}
