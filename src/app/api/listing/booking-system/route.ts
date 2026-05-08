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

export const dynamic = 'force-dynamic';
export const runtime  = 'nodejs';

// Name used to identify the managed Speed-to-Lead automation.
const STL_NAME = 'Speed to Lead — Booking System';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface StepConfig {
  id?:          string;   // existing step row id (undefined for new rows)
  step_order:   number;
  step_type:    'send_sms' | 'send_email' | 'delay';
  label:        string;   // friendly label shown in the UI
  // send_sms / send_email
  body?:        string;
  subject?:     string;
  // delay
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
  // Phase 3 — AI Concierge long-tail
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

  // Load the managed automation (if it exists).
  const { data: auto } = await supabaseAdmin
    .from('marketing_automations')
    .select('id, status')
    .eq('venue_id', venueId)
    .eq('name', STL_NAME)
    .maybeSingle();

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
        delay_minutes: (cfg.delay_minutes as number | undefined) ?? 0,
      };
    });
  }

  const cfg: BookingSystemConfig = {
    masterEnabled:      (v.booking_system_enabled as boolean | null) ?? true,
    guideEmailEnabled:  (v.booking_guide_email_enabled as boolean | null) ?? true,
    guideSmsEnabled:    (v.booking_guide_sms_enabled   as boolean | null) ?? true,
    guideEmailBody:     (v.booking_guide_email_body as string | null) ?? DEFAULT_GUIDE_EMAIL,
    guideSmsBody:       (v.booking_guide_sms_body   as string | null) ?? DEFAULT_GUIDE_SMS,
    sequenceEnabled:    automationActive,
    steps,
    automationId,
    automationActive,
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
  if (body.steps !== undefined || body.sequenceEnabled !== undefined) {
    const status = body.sequenceEnabled === false ? 'inactive' : 'active';

    // Find or create the managed automation.
    let { data: auto } = await supabaseAdmin
      .from('marketing_automations')
      .select('id')
      .eq('venue_id', venueId)
      .eq('name', STL_NAME)
      .maybeSingle();

    if (!auto) {
      const { data: created } = await supabaseAdmin
        .from('marketing_automations')
        .insert({
          venue_id:      venueId,
          name:          STL_NAME,
          status,
          trigger_type:  'form_submitted',
          trigger_config: {},
        })
        .select('id')
        .single();
      auto = created;
    } else if (body.sequenceEnabled !== undefined) {
      await supabaseAdmin
        .from('marketing_automations')
        .update({ status })
        .eq('id', auto.id);
    }

    if (!auto) return NextResponse.json({ error: 'Could not create automation' }, { status: 500 });

    const autoId = auto.id as string;

    if (body.steps !== undefined) {
      // Delete all existing steps then re-insert in order.
      await supabaseAdmin
        .from('marketing_automation_steps')
        .delete()
        .eq('automation_id', autoId);

      if (body.steps.length > 0) {
        const inserts = body.steps.map((s, i) => ({
          automation_id: autoId,
          step_order:    i,
          step_type:     s.step_type,
          config_json:   {
            label:         s.label,
            body:          s.body          ?? '',
            subject:       s.subject       ?? '',
            delay_minutes: s.delay_minutes ?? 0,
            mode:          s.step_type === 'send_email' ? 'quick' : undefined,
          },
        }));
        await supabaseAdmin.from('marketing_automation_steps').insert(inserts);
      }
    }
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

const DEFAULT_GUIDE_EMAIL = `Hi {{first_name}},

Thanks for your interest in {{venue_name}}! Your pricing guide is ready — click below to view it.

{{pricing_guide_url}}

We'd love to show you around. Reply to this email or visit the link above to learn more.

– {{venue_name}}`;

const DEFAULT_GUIDE_SMS = `Hi {{first_name}}! Thanks for your interest in {{venue_name}}. Here's your pricing guide: {{pricing_guide_url}} — Reply to ask any questions!`;

const DEFAULT_AI_MESSAGES = [
  `Hi {{first_name}}, just checking in! {{venue_name}} has some great dates still available. Would love to answer any questions you have.`,
  `Hey {{first_name}}! Still thinking about {{venue_name}}? I'm here if you'd like to schedule a quick tour.`,
  `Hi {{first_name}}, wanted to make sure you got everything you needed about {{venue_name}}. Reach out anytime — we'd love to meet you!`,
  `Hey {{first_name}}! A few couples have been inquiring about the same dates you looked at. Happy to chat if you have questions.`,
  `Hi {{first_name}}, just a friendly reminder that {{venue_name}} would love to be part of your big day. Reply anytime!`,
];
