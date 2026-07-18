/**
 * Booking System API — unified read/write for the Speed-to-Lead page.
 *
 * GET  → returns the full system config: guide delivery flags, 14-day
 *        sequence steps, AI concierge settings, and master on/off.
 *
 * PATCH → saves any combination of the above. Writes to:
 *         - venues   (ai_concierge_enabled, ai_concierge_notify_emails,
 *                     booking_system_enabled)
 *         - marketing_automations + marketing_automation_steps  (sequence)
 *
 * The booking_system_enabled flag lives on venues.  If the column doesn't
 * exist yet (pre-migration) we skip the write gracefully and treat it as
 * always-enabled.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { DEFAULT_GUIDE_EMAIL_BODY, DEFAULT_GUIDE_SMS_BODY } from '@/lib/marketing-email-worker';
import { loadDirectoryNavAccess } from '@/lib/directory-plans-venue';
import {
  PHASE4_STAGE_NAME,
  PHASE5_STAGE_NAME,
  resolveDefaultStageIdByName,
} from '@/lib/booking-system-stages';
import { STL_NAME, PHASE4_NAME, PHASE5_NAME, PHASE6_NAME } from '@/lib/booking-system-sequences';

// Re-exported for backwards compatibility with existing importers of this
// route file (e.g. `stage-default/route.ts`). Source of truth now lives in
// `src/lib/booking-system-stages.ts` so lib-only modules (like
// `marketing-email-worker.ts`) can depend on these without importing a route.
export { PHASE4_STAGE_NAME, PHASE5_STAGE_NAME, resolveDefaultStageIdByName };

export const dynamic = 'force-dynamic';
export const runtime  = 'nodejs';

// Automation names are the single source of truth in
// '@/lib/booking-system-sequences' so both this route and the super-admin
// analytics panel identify the same sequences. Re-exported here for the many
// existing importers of these constants.
// Note: the old "Nurture Sequence — Booking System" (Phase 3) automation was
// removed from this page's UI — venues can build that kind of nurture
// content directly via Email Campaigns instead. Any pre-existing automation
// rows with that name were paused via migrations/163.
export { STL_NAME, PHASE4_NAME, PHASE5_NAME, PHASE6_NAME };
// Days after the wedding date the anniversary email fires (1 year).
export const ANNIVERSARY_DAYS_AFTER_WEDDING = 365;

// Stable stage keys used by the /stage-default publish/reset API and by
// `booking_system_stage_defaults.stage_key` (migrations/164, 165).
//
// 'phase1' (guide delivery) is a bit different from the other three: it has
// no StepConfig[] automation sequence, just two on/off toggles + a single
// fixed email body and a single fixed SMS body (`guideEmailBody` /
// `guideSmsBody` on the venue row). Its `booking_system_stage_defaults` row
// stores `{ guideEmailBody, guideSmsBody }` instead of a steps array, and
// reset/publish write directly to `venues` instead of
// `marketing_automation_steps` — see /stage-default/route.ts.
export type StageKey = 'phase1' | 'phase2' | 'phase4' | 'phase5' | 'phase6';
export const ALL_STAGE_KEYS: StageKey[] = ['phase1', 'phase2', 'phase4', 'phase5', 'phase6'];

/** The subset of stage keys backed by a `marketing_automations` row + StepConfig[] sequence. */
export type AutomationStageKey = 'phase2' | 'phase4' | 'phase5' | 'phase6';

// Maps each automation-backed stage key to the automation name it corresponds to.
export const STAGE_KEY_TO_AUTOMATION_NAME: Record<AutomationStageKey, string> = {
  phase2: STL_NAME,
  phase4: PHASE4_NAME,
  phase5: PHASE5_NAME,
  phase6: PHASE6_NAME,
};

export function isAutomationStageKey(key: StageKey): key is AutomationStageKey {
  return key === 'phase2' || key === 'phase4' || key === 'phase5' || key === 'phase6';
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface StepConfig {
  id?:          string;   // existing step row id (undefined for new rows)
  step_order:   number;
  step_type:    'send_sms' | 'send_email' | 'delay' | 'start_ai_concierge';
  label:        string;   // friendly label shown in the UI
  // send_sms / send_email
  body?:        string;
  subject?:     string;
  preview_text?: string;
  image_url?:   string;
  image_link?:  string;
  button_text?: string;
  button_link?: string;
  // delay (1-3 days only for booking system)
  delay_minutes?: number;
}

export interface BookingSystemConfig {
  masterEnabled:          boolean;
  // Phase 1 — guide delivery
  guideEmailEnabled:      boolean;
  guideSmsEnabled:        boolean;
  guideEmailBody:         string;
  guideSmsBody:           string;
  // Phase 2 — 14-day sequence
  sequenceEnabled:        boolean;
  steps:                  StepConfig[];
  automationId:           string | null;
  automationActive:       boolean;
  // Phase 4 — Booked Tour
  phase4Enabled:          boolean;
  phase4Steps:            StepConfig[];
  // Phase 5 — Booked Wedding
  phase5Enabled:          boolean;
  phase5Steps:            StepConfig[];
  // Anniversary — single email one year after the wedding date
  anniversaryEnabled:     boolean;
  anniversarySteps:       StepConfig[];
  // Phase 5 — AI Concierge long-tail
  aiEnabled:              boolean;
  aiPersonaName:          string;
  aiMaxDays:              number;
  aiMinGapDays:           number;
  aiMaxGapDays:           number;
  aiMessages:             string[];
  aiNotifyEmails:         string[];
  /** Venue's own email — prefilled as the default recipient for test sends. */
  ownerEmail:             string;
  // Eligibility
  a2pVerified:            boolean;
  ghlConnected:           boolean;
  /** Whether the venue's plan tier includes the AI Concierge (All-Inclusive). */
  aiConciergeAllowed:     boolean;
  /**
   * Whether the current venue IS the "Demo Venue" — the master template
   * venue whose live stage config can be "Saved as Default" for every other
   * venue to "Reset to Default" from (see /stage-default route).
   */
  isDemoVenue:            boolean;
}

/** Name of the master-template venue — see migrations/162, 163, 164. */
export const DEMO_VENUE_NAME = 'Demo Venue';

/**
 * AI Concierge is a higher-tier (All-Inclusive) feature. Allowed when the
 * venue's plan grants the `nav_marketing_ai_concierge` nav permission, or for
 * legacy/no-plan venues (full access). Free + Bride Booking System plans do not
 * include it.
 */
async function venueAllowsAiConcierge(venueId: string): Promise<boolean> {
  try {
    const nav = await loadDirectoryNavAccess(venueId);
    if (nav.mode === 'full') return true;
    return (nav.allowedNavIds ?? []).includes('nav_marketing_ai_concierge');
  } catch {
    return true; // fail open — don't lock a paying venue out on a transient error
  }
}

// ─── GET ────────────────────────────────────────────────────────────────────

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select(
      'name, ai_concierge_enabled, ai_assistant_persona_name, ai_concierge_notify_emails, ' +
      'a2p_verified, ghl_connected, notification_email, email, ' +
      'booking_system_enabled, booking_guide_email_enabled, booking_guide_sms_enabled, ' +
      'booking_guide_email_body, booking_guide_sms_body, ' +
      'booking_ai_max_days, booking_ai_min_gap_days, booking_ai_max_gap_days, booking_ai_messages',
    )
    .eq('id', venueId)
    .maybeSingle();

  if (!venue) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

  const v = venue as unknown as Record<string, unknown>;

  // Load the managed automations
  const { data: autos } = await supabaseAdmin
    .from('marketing_automations')
    .select('id, name, status')
    .eq('venue_id', venueId)
    .in('name', [STL_NAME, PHASE4_NAME, PHASE5_NAME, PHASE6_NAME]);

  const loadAuto = async (name: string, defaultSteps: StepConfig[] = []) => {
    const auto = autos?.find(a => a.name === name);
    let steps: StepConfig[] = [];
    let automationId: string | null = null;
    let automationActive = false;

    if (auto) {
      automationId   = auto.id as string;
      automationActive = (auto.status as string) === 'active';
      const { data: stepRows } = await supabaseAdmin
        .from('marketing_automation_steps')
        .select('id, step_order, step_type, config_json')
        .eq('automation_id', auto.id)
        .order('step_order', { ascending: true });

      steps = formatStepRows(stepRows ?? []);
    }

    // First-time / never-customized state: no automation row (or an
    // automation row with zero saved steps) yet — show pre-filled, fully
    // editable defaults instead of an empty sequence. Nothing is written to
    // the DB until the venue owner actually saves.
    if (steps.length === 0 && defaultSteps.length > 0) {
      steps = defaultSteps;
    }

    return { steps, automationId, automationActive };
  };

  const phase2 = await loadAuto(STL_NAME, DEFAULT_PHASE2_STEPS);
  const phase4 = await loadAuto(PHASE4_NAME, DEFAULT_PHASE4_STEPS);
  const phase5 = await loadAuto(PHASE5_NAME, DEFAULT_PHASE5_STEPS);
  const phase6 = await loadAuto(PHASE6_NAME, DEFAULT_PHASE6_STEPS);

  const cfg: BookingSystemConfig = {
    masterEnabled:      (v.booking_system_enabled as boolean | null) ?? true,
    guideEmailEnabled:  (v.booking_guide_email_enabled as boolean | null) ?? true,
    guideSmsEnabled:    (v.booking_guide_sms_enabled   as boolean | null) ?? true,
    guideEmailBody:     (v.booking_guide_email_body as string | null) ?? DEFAULT_GUIDE_EMAIL_BODY,
    guideSmsBody:       (v.booking_guide_sms_body   as string | null) ?? DEFAULT_GUIDE_SMS_BODY,
    // New venues (no automation row yet) default Phase 2 to ON — mirrors the
    // phase5 special-case pattern below but inverted (phase5 defaults off).
    sequenceEnabled:    phase2.automationId ? phase2.automationActive : true,
    steps:              phase2.steps,
    automationId:       phase2.automationId,
    automationActive:   phase2.automationActive,
    phase4Enabled:      phase4.automationActive,
    phase4Steps:        phase4.steps,
    phase5Enabled:      phase5.automationId ? phase5.automationActive : false,
    phase5Steps:        phase5.steps,
    anniversaryEnabled: phase6.automationId ? phase6.automationActive : false,
    anniversarySteps:   phase6.steps,
    aiEnabled:          (v.ai_concierge_enabled as boolean | null) ?? false,
    aiPersonaName:      (v.ai_assistant_persona_name as string | null) ?? 'StoryVenue Concierge',
    aiMaxDays:          (v.booking_ai_max_days     as number | null) ?? 60,
    aiMinGapDays:       (v.booking_ai_min_gap_days as number | null) ?? 1,
    aiMaxGapDays:       (v.booking_ai_max_gap_days as number | null) ?? 3,
    aiMessages:         (v.booking_ai_messages     as string[] | null) ?? DEFAULT_AI_MESSAGES,
    aiNotifyEmails:     (v.ai_concierge_notify_emails as string[] | null) ?? [],
    ownerEmail:         ((v.notification_email as string | null)?.trim() || (v.email as string | null)?.trim()) ?? '',
    a2pVerified:        (v.a2p_verified  as boolean | null) ?? false,
    ghlConnected:       (v.ghl_connected as boolean | null) ?? false,
    aiConciergeAllowed: await venueAllowsAiConcierge(venueId),
    isDemoVenue:        (v.name as string | null) === DEMO_VENUE_NAME,
  };

  // When the master switch is off, present every individual stage as disabled
  // in the UI without touching their stored DB state. When the master comes
  // back on, each stage's real status is restored from the DB automatically.
  if (!cfg.masterEnabled) {
    cfg.guideEmailEnabled = false;
    cfg.guideSmsEnabled   = false;
    cfg.sequenceEnabled   = false;
    cfg.automationActive  = false;
    cfg.phase4Enabled     = false;
    cfg.phase5Enabled     = false;
    cfg.anniversaryEnabled = false;
    cfg.aiEnabled         = false;
  }

  return NextResponse.json(cfg);
}

// ─── PATCH ──────────────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Partial<BookingSystemConfig>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  // ── Venue-level fields ───────────────────────────────────────────────────
  const venueUpdate: Record<string, unknown> = {};
  if (body.masterEnabled     !== undefined) venueUpdate.booking_system_enabled      = body.masterEnabled;
  if (body.guideEmailEnabled !== undefined) venueUpdate.booking_guide_email_enabled = body.guideEmailEnabled;
  if (body.guideSmsEnabled   !== undefined) venueUpdate.booking_guide_sms_enabled   = body.guideSmsEnabled;
  if (body.guideEmailBody    !== undefined) venueUpdate.booking_guide_email_body    = body.guideEmailBody;
  if (body.guideSmsBody      !== undefined) venueUpdate.booking_guide_sms_body      = body.guideSmsBody;
  if (body.aiEnabled         !== undefined) venueUpdate.ai_concierge_enabled        = body.aiEnabled;
  if (body.aiPersonaName     !== undefined) venueUpdate.ai_assistant_persona_name   = body.aiPersonaName;
  if (body.aiMaxDays         !== undefined) venueUpdate.booking_ai_max_days         = body.aiMaxDays;
  if (body.aiMinGapDays      !== undefined) venueUpdate.booking_ai_min_gap_days     = body.aiMinGapDays;
  if (body.aiMaxGapDays      !== undefined) venueUpdate.booking_ai_max_gap_days     = body.aiMaxGapDays;
  if (body.aiMessages        !== undefined) venueUpdate.booking_ai_messages         = body.aiMessages;
  if (body.aiNotifyEmails    !== undefined) venueUpdate.ai_concierge_notify_emails  = body.aiNotifyEmails;

  // Master switch OFF → force AI concierge off too so every automated/AI
  // workflow stops immediately. The venue owner must re-enable AI manually
  // after turning the system back on.
  if (body.masterEnabled === false) {
    venueUpdate.ai_concierge_enabled = false;
  }

  if (Object.keys(venueUpdate).length > 0) {
    // Some columns may not exist yet (added by migration). Ignore column errors.
    const { error: ve } = await supabaseAdmin
      .from('venues')
      .update(venueUpdate)
      .eq('id', venueId);
    if (ve && !/column/.test(ve.message)) {
      return NextResponse.json({ error: ve.message }, { status: 500 });
    }
  }

  // When the master switch is turned OFF, pause every lead whose AI is
  // currently active or in handoff so the concierge stops sending immediately.
  if (body.masterEnabled === false) {
    await supabaseAdmin
      .from('leads')
      .update({ ai_state: 'paused' })
      .eq('venue_id', venueId)
      .in('ai_state', ['ai_active', 'handoff']);
  }

  // ── Sequence steps ───────────────────────────────────────────────────────
  const saveAutomation = async (
    name: string,
    enabled: boolean | undefined,
    steps: StepConfig[] | undefined,
    triggerType: string,
    // When provided, this is set/corrected on the automation row on every
    // save (both create and update) — used to self-heal Phase 4/5's
    // trigger_config to the venue's current default-pipeline stage id even
    // if the row was created before this was wired up correctly.
    triggerConfig?: Record<string, unknown>,
  ) => {
    if (enabled === undefined && steps === undefined) return;

    // Must match the marketing_automations_status_chk constraint, which only
    // allows 'draft' | 'active' | 'paused'. The "off" state is 'paused'.
    const status = enabled === false ? 'paused' : 'active';

    // Find or create the managed automation.
    let { data: auto } = await supabaseAdmin
      .from('marketing_automations')
      .select('id')
      .eq('venue_id', venueId)
      .eq('name', name)
      .maybeSingle();

    if (!auto) {
      const { data: created, error: createErr } = await supabaseAdmin
        .from('marketing_automations')
        .insert({
          venue_id:      venueId,
          name:          name,
          status,
          trigger_type:  triggerType,
          trigger_config: triggerConfig ?? {},
        })
        .select('id')
        .single();
      if (createErr) {
        console.error(`[booking-system] failed to create automation ${name}:`, createErr);
        throw new Error(`Failed to create automation: ${createErr.message}`);
      }
      auto = created;
    } else {
      const updatePayload: Record<string, unknown> = {};
      if (enabled !== undefined) updatePayload.status = status;
      // Self-heal trigger wiring on every save, not just at creation, so
      // pre-existing rows with the old (buggy) trigger get corrected.
      if (triggerConfig !== undefined) {
        updatePayload.trigger_type = triggerType;
        updatePayload.trigger_config = triggerConfig;
      }
      if (Object.keys(updatePayload).length > 0) {
        const { error: statusErr } = await supabaseAdmin
          .from('marketing_automations')
          .update(updatePayload)
          .eq('id', auto.id);
        if (statusErr) console.warn(`[booking-system] automation update failed for ${name}:`, statusErr);
      }
    }

    if (!auto) throw new Error(`Could not create automation ${name}`);

    const autoId = auto.id as string;

    if (steps !== undefined) {
      // Delete all existing steps then re-insert in order.
      const { error: delErr } = await supabaseAdmin
        .from('marketing_automation_steps')
        .delete()
        .eq('automation_id', autoId);
      if (delErr) {
        console.error(`[booking-system] failed to clear existing steps for ${name}:`, delErr);
        throw new Error(`Failed to clear existing steps: ${delErr.message}`);
      }

      if (steps.length > 0) {
        const inserts = steps.map((s, i) => ({
          automation_id: autoId,
          step_order:    i,
          step_type:     s.step_type,
          config_json:   {
            label:         s.label,
            body:          s.body          ?? '',
            subject:       s.subject       ?? '',
            preview_text:  s.preview_text  ?? '',
            image_url:     s.image_url     ?? '',
            image_link:    s.image_link    ?? '',
            button_text:   s.button_text   ?? '',
            button_link:   s.button_link   ?? '',
            delay_minutes: s.delay_minutes ?? 0,
            mode:          s.step_type === 'send_email' ? 'quick' : undefined,
          },
        }));
        const { error: insErr } = await supabaseAdmin
          .from('marketing_automation_steps')
          .insert(inserts);
        if (insErr) {
          console.error(`[booking-system] failed to insert steps for ${name}:`, insErr);
          const msg = insErr.message || 'Unknown insert error';
          const hint = /step_type_check|violates check constraint/i.test(msg)
            ? 'Database migration 119 has not been applied yet — please run migrations/119_booking_system_step_types.sql in Supabase.'
            : null;
          throw new Error(`Failed to save steps: ${msg}${hint ? ` (${hint})` : ''}`);
        }
      }
    }
  };

  try {
    await saveAutomation(STL_NAME, body.sequenceEnabled, body.steps, 'form_submitted');

    // Phase 4/5 fire on entering a specific pipeline stage. Resolve the
    // venue's own default-pipeline stage id every save so any pre-existing
    // rows self-heal from the old (buggy) 'tag_added'-matches-anything
    // trigger to the correct stage_changed trigger.
    if (body.phase4Enabled !== undefined || body.phase4Steps !== undefined) {
      const tourStageId = await resolveDefaultStageIdByName(venueId, PHASE4_STAGE_NAME);
      await saveAutomation(
        PHASE4_NAME, body.phase4Enabled, body.phase4Steps, 'stage_changed',
        tourStageId ? { to_stage_ids: [tourStageId] } : undefined,
      );
    }
    if (body.phase5Enabled !== undefined || body.phase5Steps !== undefined) {
      const weddingStageId = await resolveDefaultStageIdByName(venueId, PHASE5_STAGE_NAME);
      await saveAutomation(
        PHASE5_NAME, body.phase5Enabled, body.phase5Steps, 'stage_changed',
        weddingStageId ? { to_stage_ids: [weddingStageId] } : undefined,
      );
    }
    // Anniversary — fires once a year after the wedding date via the daily
    // wedding-date-followup cron. The trigger offset is fixed at 365 days.
    if (body.anniversaryEnabled !== undefined || body.anniversarySteps !== undefined) {
      await saveAutomation(
        PHASE6_NAME, body.anniversaryEnabled, body.anniversarySteps, 'wedding_date_followup',
        { days_after_wedding: ANNIVERSARY_DAYS_AFTER_WEDDING },
      );
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to save automations' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// ─── Reset-to-default step replacement ─────────────────────────────────────

/**
 * Replaces ONLY a venue's automation step content for the named automation —
 * used by the /stage-default "reset" action. Unlike `saveAutomation` in
 * PATCH above, this NEVER touches `status` (the on/off toggle) on an
 * existing row — resetting a stage's message content must never flip a
 * venue's stage on or off. If no automation row exists yet for this venue
 * (e.g. it was never saved before), one is created in the 'paused' (off)
 * state so a reset can never silently turn a stage on either.
 */
export async function replaceAutomationStepsOnly(
  venueId: string,
  automationName: string,
  triggerTypeForCreate: string,
  steps: StepConfig[],
  triggerConfigForCreate?: Record<string, unknown>,
): Promise<{ automationId: string; automationActive: boolean }> {
  let { data: auto } = await supabaseAdmin
    .from('marketing_automations')
    .select('id, status')
    .eq('venue_id', venueId)
    .eq('name', automationName)
    .maybeSingle();

  if (!auto) {
    const { data: created, error: createErr } = await supabaseAdmin
      .from('marketing_automations')
      .insert({
        venue_id:       venueId,
        name:           automationName,
        status:         'paused',
        trigger_type:   triggerTypeForCreate,
        trigger_config: triggerConfigForCreate ?? {},
      })
      .select('id, status')
      .single();
    if (createErr) throw new Error(`Failed to create automation: ${createErr.message}`);
    auto = created;
  }

  if (!auto) throw new Error(`Could not create automation ${automationName}`);

  const autoId = auto.id as string;

  const { error: delErr } = await supabaseAdmin
    .from('marketing_automation_steps')
    .delete()
    .eq('automation_id', autoId);
  if (delErr) throw new Error(`Failed to clear existing steps: ${delErr.message}`);

  if (steps.length > 0) {
    const inserts = steps.map((s, i) => ({
      automation_id: autoId,
      step_order:    i,
      step_type:     s.step_type,
      config_json:   {
        label:         s.label,
        body:          s.body          ?? '',
        subject:       s.subject       ?? '',
        preview_text:  s.preview_text  ?? '',
        image_url:     s.image_url     ?? '',
        image_link:    s.image_link    ?? '',
        button_text:   s.button_text   ?? '',
        button_link:   s.button_link   ?? '',
        delay_minutes: s.delay_minutes ?? 0,
        mode:          s.step_type === 'send_email' ? 'quick' : undefined,
      },
    }));
    const { error: insErr } = await supabaseAdmin
      .from('marketing_automation_steps')
      .insert(inserts);
    if (insErr) throw new Error(`Failed to save steps: ${insErr.message}`);
  }

  return { automationId: autoId, automationActive: (auto.status as string) === 'active' };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Maps raw `marketing_automation_steps` rows (as selected with
 * `id, step_order, step_type, config_json`) into the UI-facing `StepConfig[]`
 * shape. Shared by GET here and by the /stage-default route so both stay in
 * sync with the same field defaults.
 */
export function formatStepRows(
  stepRows: Array<{ id?: string; step_order: unknown; step_type: unknown; config_json: unknown }>,
): StepConfig[] {
  return stepRows.map((s) => {
    const cfg = (s.config_json ?? {}) as Record<string, unknown>;
    return {
      id:            s.id as string | undefined,
      step_order:    s.step_order as number,
      step_type:     s.step_type as StepConfig['step_type'],
      label:         (cfg.label as string | undefined) ?? labelForStep(s.step_type as string, cfg),
      body:          (cfg.body as string | undefined) ?? '',
      subject:       (cfg.subject as string | undefined) ?? '',
      preview_text:  (cfg.preview_text as string | undefined) ?? '',
      image_url:     (cfg.image_url as string | undefined) ?? '',
      image_link:    (cfg.image_link as string | undefined) ?? '',
      button_text:   (cfg.button_text as string | undefined) ?? '',
      button_link:   (cfg.button_link as string | undefined) ?? '',
      delay_minutes: (cfg.delay_minutes as number | undefined) ?? 0,
    };
  });
}

export function labelForStep(type: string, cfg: Record<string, unknown>): string {
  if (type === 'delay') {
    const m = Number(cfg.delay_minutes ?? 0);
    const d = Math.round(m / 1440);
    return d > 0 ? `Wait ${d} day${d !== 1 ? 's' : ''}` : `Wait ${m} min`;
  }
  if (type === 'send_sms')   return 'Send SMS';
  if (type === 'send_email') return 'Send email';
  return type;
}

// ─── Phase 2 default — "Guide Delivered → 14-Day Sequence" ─────────────────
// Alternating [delay, sms, delay, sms, ...]; each delay is the increment from
// the previous touch (deltas: 1,1,1,2,2,3,4 days → Day 1,2,3,5,7,10,14).
const DEFAULT_PHASE2_STEPS: StepConfig[] = [
  { step_order: 0,  step_type: 'delay',    label: 'Wait 1 day',  delay_minutes: 1 * 1440 },
  { step_order: 1,  step_type: 'send_sms', label: 'Day 1',
    body: `Hi {{first_name}}! It's {{owner_name}} over at {{venue_name}}, just making sure the pricing and availability guide landed in your inbox ok? 😊 And do you have a date in mind yet? Happy to peek at the calendar and see if it's still open for you!` },
  { step_order: 2,  step_type: 'delay',    label: 'Wait 1 day',  delay_minutes: 1 * 1440 },
  { step_order: 3,  step_type: 'send_sms', label: 'Day 2',
    body: `Hey {{first_name}}, this is {{owner_name}} from {{venue_name}}. Saw you downloaded our guide! Just making sure it reached you ok? And do you have a date picked out yet? Happy to check if it's still open for you.` },
  { step_order: 4,  step_type: 'delay',    label: 'Wait 1 day',  delay_minutes: 1 * 1440 },
  { step_order: 5,  step_type: 'send_sms', label: 'Day 3',
    body: `Hi {{first_name}}! Totally get that looking at venues can feel like a lot. If it's easier, just tell me the one thing you're trying to figure out right now and I'll help with that.` },
  { step_order: 6,  step_type: 'delay',    label: 'Wait 2 days', delay_minutes: 2 * 1440 },
  { step_order: 7,  step_type: 'send_sms', label: 'Day 5',
    body: `Hi {{first_name}}! Okay, fun question. 😊 Are you picturing spring blooms, summer sunsets, or cozy fall vibes for your wedding?` },
  { step_order: 8,  step_type: 'delay',    label: 'Wait 2 days', delay_minutes: 2 * 1440 },
  { step_order: 9,  step_type: 'send_sms', label: 'Day 7',
    body: `Hey {{first_name}}! Feels like there might be a few things easier to just talk through than text back and forth. Want to hop on a quick 5-min call? Whenever's good for you, no pressure at all.` },
  { step_order: 10, step_type: 'delay',    label: 'Wait 3 days', delay_minutes: 3 * 1440 },
  { step_order: 11, step_type: 'send_sms', label: 'Day 10',
    body: `Hey {{first_name}}, there's so much that goes into planning your wedding day. 😊 Please don't feel like you have to figure it all out by yourself. I'd love to help however I can.` },
  { step_order: 12, step_type: 'delay',    label: 'Wait 4 days', delay_minutes: 4 * 1440 },
  { step_order: 13, step_type: 'send_sms', label: 'Day 14',
    body: `Hi {{first_name}}! When you reached out about {{venue_name}}, I didn't want to just send a guide and disappear on you. So I wanted to check in one more time, is there anything you're still wondering about that I can help with?` },
];

// ─── Phase 4 default — "Booked Tour → Toured" ──────────────────────────────
// Appointment-reminder SMS's ("day before" / "morning of") are intentionally
// excluded here — those are handled by the calendar notification system.
const DEFAULT_PHASE4_STEPS: StepConfig[] = [
  { step_order: 0, step_type: 'send_sms', label: 'Touch 1 — Immediate',
    body: `Hi {{first_name}}, it's {{owner_name}} from {{venue_name}}. I'm so glad you booked a tour with us. I just sent everything over to your email so keep an eye out for it. It has all the little details to make your visit easy. Can't wait to meet you.` },
  { step_order: 1, step_type: 'send_email', label: 'Touch 2 — Immediate',
    subject: 'Everything for your visit to {{venue_name}}',
    body: `Hi {{first_name}},\n\nI'm so happy you're coming to see us. I wanted to get everything to you in one place so the day of your tour feels easy and you can just enjoy it.\n\nHere's what to know:\nWhen: {{appointment_date}} at {{appointment_time}}\nWhere: {{venue_address}}\nParking: [Add parking/entrance details here]\n\nPlan for about [30 to 45 minutes] together. I'll walk you through the whole space, show you where everything happens on a wedding day, and answer anything on your mind. Bring whoever helps you make big decisions, a partner, your mom, a friend, whoever you want with you.\n\nIf anything comes up before then, just reply here or text me. I'm easy to reach.\n\nSee you soon,\n{{owner_name}}\n{{venue_name}}` },
  { step_order: 2, step_type: 'delay', label: 'Wait 2 days', delay_minutes: 2 * 1440 },
  { step_order: 3, step_type: 'send_email', label: 'Touch 3',
    subject: 'A little of what I love about this place',
    body: `Hi {{first_name}},\n\nI keep thinking about your visit coming up. Before you get here I wanted to share a little of why couples fall for this place.\n\n[Add 1-2 sentences on your venue's signature moment — the light in the afternoon, the ceremony spot, the view, the thing brides always gasp at.]\n\n[Add 1-2 sentences painting a real wedding day here — where she'd get ready, where the first look happens, where everyone dances at night.]\n\nWhen you're here I'd love to hear what you're picturing for your day. The season you're dreaming of, the feeling you want your guests to walk into. That's my favorite part, helping you see it in the space.\n\nSee you soon,\n{{owner_name}}\n{{venue_name}}` },
];

// ─── Phase 5 default — "Booked Wedding → Welcomed" ─────────────────────────
const DEFAULT_PHASE5_STEPS: StepConfig[] = [
  { step_order: 0, step_type: 'send_sms', label: 'Touch 1 — Immediate',
    body: `Hi {{first_name}}, it's {{owner_name}} from {{venue_name}}. It's official, you're getting married at {{venue_name}} and I could not be more excited for you. I just sent a welcome note to your email with everything for what comes next. Congratulations, this is going to be so good.` },
  { step_order: 1, step_type: 'send_email', label: 'Touch 2 — Immediate',
    subject: "You're getting married at {{venue_name}}",
    body: `Hi {{first_name}},\n\nIt's official and I am so happy. You're getting married at {{venue_name}}, and I still get a little excited every time a couple books their day with us. Thank you for trusting us with something this big. It means the world.\n\nI want you to know you don't have to have anything figured out right now. There is so much time, and I'll be with you the whole way. Over the coming months I'll check in, share a few helpful things, and always make sure you know what's next.\n\nFor right now, all you have to do is enjoy this. You picked your place. That's the big one, and everything gets easier from here.\n\n[Optional: add your next step here — e.g. payment date / planning meeting / portal login — and I'll walk you through it when it's time.]\n\nAnytime a question pops into your head, just reply here or text me. I'm your person for all of it.\n\nCongratulations {{first_name}},\n{{owner_name}}\n{{venue_name}}` },
  { step_order: 2, step_type: 'delay', label: 'Wait 3 days', delay_minutes: 3 * 1440 },
  { step_order: 3, step_type: 'send_email', label: 'Touch 3',
    subject: 'What to expect between now and your wedding',
    body: `Hi {{first_name}},\n\nNow that the excitement has settled a little, I wanted to walk you through how this all works so nothing ever feels like a mystery.\n\nHere's the simple version. Between now and your wedding, we'll stay in touch at a few key points along the way. [Add your typical planning-meeting timeframe here.] You will never have to guess what's next. I'll always tell you.\n\nYou don't need to rush any of it. The couples who enjoy this most are the ones who take it one step at a time, and that's exactly how we'll do it together.\n\nIf anything ever feels unclear, or you just want to talk something through, I'm one message away.\n\nTalk soon,\n{{owner_name}}\n{{venue_name}}` },
  { step_order: 4, step_type: 'delay', label: 'Wait 7 days', delay_minutes: 7 * 1440 },
  { step_order: 5, step_type: 'send_email', label: 'Touch 4',
    subject: 'A few easy things to do after booking',
    body: `Hi {{first_name}},\n\nA few couples have asked me what they should do first after booking, so I put together the short list. None of this is urgent. It's just the stuff that makes everything later feel calmer.\n\nSave your date everywhere. Put it in your calendar, tell the people closest to you, make it real.\n\nStart a little inspiration folder. Anything that catches your eye, colors, flowers, a dress, a feeling. It helps more than you would think when we start planning.\n\nHave a rough idea of who's coming. Not a final list, just a ballpark. It quietly shapes almost every other decision, so even a loose number helps.\n\nThat's it. Do them whenever you feel like it. And if you would rather just sit in the excitement a little longer, that's completely allowed too.\n\nHere for you,\n{{owner_name}}\n{{venue_name}}` },
  { step_order: 6, step_type: 'delay', label: 'Wait 1 day', delay_minutes: 1 * 1440 },
  { step_order: 7, step_type: 'send_sms', label: 'Touch 5',
    body: `Hi {{first_name}}, it's {{owner_name}}. I just wanted you to hear it from me one more time, you're in good hands and I'm so glad we get to be part of your day. Anything you need between now and then, I'm right here. No question is too small.` },
];

// ─── Anniversary default — single email, one year after the wedding date ────
const DEFAULT_PHASE6_STEPS: StepConfig[] = [
  { step_order: 0, step_type: 'send_email', label: 'Happy Anniversary',
    subject: 'Happy anniversary, {{first_name}} 💛',
    body: `Hi {{first_name}},\n\nOne year ago you got married at {{venue_name}}, and I've been thinking about you two. I hope this year has been everything you hoped for and then some.\n\nWe still talk about your day here. It meant so much to us to be part of it.\n\nIf you ever find yourself back in the area, we'd love to see you. And if anyone you love is starting to plan their own wedding, you know where to find us. 😊\n\nHappy anniversary,\n{{owner_name}}\n{{venue_name}}` },
];

const DEFAULT_AI_MESSAGES = [
  `Hi {{first_name}}, just checking in! {{venue_name}} has some great dates still available. Would love to answer any questions you have.`,
  `Hey {{first_name}}! Still thinking about {{venue_name}}? I'm here if you'd like to schedule a quick tour.`,
  `Hi {{first_name}}, wanted to make sure you got everything you needed about {{venue_name}}. Reach out anytime — we'd love to meet you!`,
  `Hey {{first_name}}! A few couples have been inquiring about the same dates you looked at. Happy to chat if you have questions.`,
  `Hi {{first_name}}, just a friendly reminder that {{venue_name}} would love to be part of your big day. Reply anytime!`,
];
