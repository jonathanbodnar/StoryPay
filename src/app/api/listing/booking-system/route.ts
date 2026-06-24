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

export const dynamic = 'force-dynamic';
export const runtime  = 'nodejs';

// Name used to identify the managed Speed-to-Lead automation.
const STL_NAME = 'Speed to Lead — Booking System';
const PHASE3_NAME = 'Nurture Sequence — Booking System';
const PHASE4_NAME = 'Booked Tour Sequence — Booking System';
const PHASE5_NAME = 'Booked Wedding Sequence — Booking System';

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
  // Phase 3 — Nurture
  phase3Enabled:          boolean;
  phase3Steps:            StepConfig[];
  // Phase 4 — Booked Tour
  phase4Enabled:          boolean;
  phase4Steps:            StepConfig[];
  // Phase 5 — Booked Wedding
  phase5Enabled:          boolean;
  phase5Steps:            StepConfig[];
  // Phase 6 — AI Concierge long-tail
  aiEnabled:              boolean;
  aiPersonaName:          string;
  aiMaxDays:              number;
  aiMinGapDays:           number;
  aiMaxGapDays:           number;
  aiMessages:             string[];
  aiNotifyEmails:         string[];
  // Eligibility
  a2pVerified:            boolean;
  ghlConnected:           boolean;
}

// ─── GET ────────────────────────────────────────────────────────────────────

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select(
      'ai_concierge_enabled, ai_assistant_persona_name, ai_concierge_notify_emails, ' +
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
    .in('name', [STL_NAME, PHASE3_NAME, PHASE4_NAME, PHASE5_NAME]);

  const loadAuto = async (name: string) => {
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

      steps = (stepRows ?? []).map((s) => {
        const cfg = (s.config_json ?? {}) as Record<string, unknown>;
        return {
          id:            s.id as string,
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
    return { steps, automationId, automationActive };
  };

  const phase2 = await loadAuto(STL_NAME);
  const phase3 = await loadAuto(PHASE3_NAME);
  const phase4 = await loadAuto(PHASE4_NAME);
  const phase5 = await loadAuto(PHASE5_NAME);

  const cfg: BookingSystemConfig = {
    masterEnabled:      (v.booking_system_enabled as boolean | null) ?? true,
    guideEmailEnabled:  (v.booking_guide_email_enabled as boolean | null) ?? true,
    guideSmsEnabled:    (v.booking_guide_sms_enabled   as boolean | null) ?? true,
    guideEmailBody:     (v.booking_guide_email_body as string | null) ?? DEFAULT_GUIDE_EMAIL_BODY,
    guideSmsBody:       (v.booking_guide_sms_body   as string | null) ?? DEFAULT_GUIDE_SMS_BODY,
    sequenceEnabled:    phase2.automationActive,
    steps:              phase2.steps,
    automationId:       phase2.automationId,
    automationActive:   phase2.automationActive,
    phase3Enabled:      phase3.automationActive,
    phase3Steps:        phase3.steps,
    phase4Enabled:      phase4.automationActive,
    phase4Steps:        phase4.steps,
    phase5Enabled:      phase5.automationId ? phase5.automationActive : false,
    phase5Steps:        phase5.steps,
    aiEnabled:          (v.ai_concierge_enabled as boolean | null) ?? false,
    aiPersonaName:      (v.ai_assistant_persona_name as string | null) ?? 'StoryVenue Concierge',
    aiMaxDays:          (v.booking_ai_max_days     as number | null) ?? 60,
    aiMinGapDays:       (v.booking_ai_min_gap_days as number | null) ?? 1,
    aiMaxGapDays:       (v.booking_ai_max_gap_days as number | null) ?? 3,
    aiMessages:         (v.booking_ai_messages     as string[] | null) ?? DEFAULT_AI_MESSAGES,
    aiNotifyEmails:     (v.ai_concierge_notify_emails as string[] | null) ?? [],
    a2pVerified:        (v.a2p_verified  as boolean | null) ?? false,
    ghlConnected:       (v.ghl_connected as boolean | null) ?? false,
  };

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

  // ── Sequence steps ───────────────────────────────────────────────────────
  const saveAutomation = async (
    name: string,
    enabled: boolean | undefined,
    steps: StepConfig[] | undefined,
    triggerType: string
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
          trigger_config: {},
        })
        .select('id')
        .single();
      if (createErr) {
        console.error(`[booking-system] failed to create automation ${name}:`, createErr);
        throw new Error(`Failed to create automation: ${createErr.message}`);
      }
      auto = created;
    } else if (enabled !== undefined) {
      const { error: statusErr } = await supabaseAdmin
        .from('marketing_automations')
        .update({ status })
        .eq('id', auto.id);
      if (statusErr) console.warn(`[booking-system] sequence status update failed for ${name}:`, statusErr);
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
    await saveAutomation(PHASE3_NAME, body.phase3Enabled, body.phase3Steps, 'tag_added');
    await saveAutomation(PHASE4_NAME, body.phase4Enabled, body.phase4Steps, 'tag_added');
    await saveAutomation(PHASE5_NAME, body.phase5Enabled ?? false, body.phase5Steps, 'tag_added');
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to save automations' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function labelForStep(type: string, cfg: Record<string, unknown>): string {
  if (type === 'delay') {
    const m = Number(cfg.delay_minutes ?? 0);
    const d = Math.round(m / 1440);
    return d > 0 ? `Wait ${d} day${d !== 1 ? 's' : ''}` : `Wait ${m} min`;
  }
  if (type === 'send_sms')   return 'Send SMS';
  if (type === 'send_email') return 'Send email';
  return type;
}

const DEFAULT_AI_MESSAGES = [
  `Hi {{first_name}}, just checking in! {{venue_name}} has some great dates still available. Would love to answer any questions you have.`,
  `Hey {{first_name}}! Still thinking about {{venue_name}}? I'm here if you'd like to schedule a quick tour.`,
  `Hi {{first_name}}, wanted to make sure you got everything you needed about {{venue_name}}. Reach out anytime — we'd love to meet you!`,
  `Hey {{first_name}}! A few couples have been inquiring about the same dates you looked at. Happy to chat if you have questions.`,
  `Hi {{first_name}}, just a friendly reminder that {{venue_name}} would love to be part of your big day. Reply anytime!`,
];
