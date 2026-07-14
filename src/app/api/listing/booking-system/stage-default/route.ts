/**
 * Booking System — per-stage "Save as Default" / "Reset to Default".
 *
 * POST /api/listing/booking-system/stage-default
 *
 *   action: 'publish'
 *     Publishes the CALLING venue's current content for `stageKey` as the
 *     new global default template, stored in `booking_system_stage_defaults`.
 *     ONLY the Demo Venue may do this (enforced here, not just hidden
 *     client-side).
 *       - stageKey 'phase2' | 'phase4' | 'phase5' — body: { steps }
 *       - stageKey 'phase1'                        — body: { guideEmailBody, guideSmsBody }
 *
 *   action: 'reset' — { stageKey }
 *     Looks up the published default for `stageKey` and overwrites ONLY the
 *     calling venue's content for that stage:
 *       - 'phase2' | 'phase4' | 'phase5' — delete + reinsert
 *         `marketing_automation_steps` for the matching `marketing_automations`
 *         row (same pattern as PATCH in the parent route / migrations/162).
 *         Never touches that automation's on/off status or trigger wiring
 *         beyond self-healing on first creation — see `replaceAutomationStepsOnly`.
 *       - 'phase1' — writes `booking_guide_email_body` / `booking_guide_sms_body`
 *         directly onto the venue's row. Never touches
 *         `booking_guide_email_enabled` / `booking_guide_sms_enabled`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId, getMemberName } from '@/lib/auth-helpers';
import {
  STAGE_KEY_TO_AUTOMATION_NAME, DEMO_VENUE_NAME, ALL_STAGE_KEYS, isAutomationStageKey,
  PHASE4_STAGE_NAME, PHASE5_STAGE_NAME, ANNIVERSARY_DAYS_AFTER_WEDDING,
  resolveDefaultStageIdByName, replaceAutomationStepsOnly, formatStepRows,
  type StepConfig, type StageKey, type AutomationStageKey,
} from '@/app/api/listing/booking-system/route';

export const dynamic = 'force-dynamic';
export const runtime  = 'nodejs';

interface Phase1Default {
  guideEmailBody: string;
  guideSmsBody:   string;
}

function isValidStageKey(key: unknown): key is StageKey {
  return typeof key === 'string' && (ALL_STAGE_KEYS as string[]).includes(key);
}

async function isDemoVenue(venueId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('venues')
    .select('name')
    .eq('id', venueId)
    .maybeSingle();
  return (data as { name?: string } | null)?.name === DEMO_VENUE_NAME;
}

/** trigger_type + trigger_config used only if a venue's automation row for
 *  this stage doesn't exist yet and needs to be created during reset. */
async function creationDefaultsForStage(venueId: string, stageKey: AutomationStageKey): Promise<{
  triggerType: string;
  triggerConfig?: Record<string, unknown>;
}> {
  if (stageKey === 'phase4') {
    const stageId = await resolveDefaultStageIdByName(venueId, PHASE4_STAGE_NAME);
    return { triggerType: 'stage_changed', triggerConfig: stageId ? { to_stage_ids: [stageId] } : undefined };
  }
  if (stageKey === 'phase5') {
    const stageId = await resolveDefaultStageIdByName(venueId, PHASE5_STAGE_NAME);
    return { triggerType: 'stage_changed', triggerConfig: stageId ? { to_stage_ids: [stageId] } : undefined };
  }
  if (stageKey === 'phase6') {
    return { triggerType: 'wedding_date_followup', triggerConfig: { days_after_wedding: ANNIVERSARY_DAYS_AFTER_WEDDING } };
  }
  return { triggerType: 'form_submitted' };
}

export async function POST(req: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: {
    action?: string; stageKey?: string; steps?: StepConfig[];
    guideEmailBody?: string; guideSmsBody?: string;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (!isValidStageKey(body.stageKey)) {
    return NextResponse.json({ error: 'Invalid or unsupported stageKey' }, { status: 400 });
  }
  const stageKey = body.stageKey;

  if (body.action === 'publish') {
    // Server-side enforcement — publish is Demo-Venue-only regardless of
    // what the client sends/hides.
    if (!(await isDemoVenue(venueId))) {
      return NextResponse.json({ error: 'Only the Demo Venue can publish a default template' }, { status: 403 });
    }

    const actingName = (await getMemberName()) ?? DEMO_VENUE_NAME;
    const updatedAt = new Date().toISOString();

    if (stageKey === 'phase1') {
      if (typeof body.guideEmailBody !== 'string' || typeof body.guideSmsBody !== 'string') {
        return NextResponse.json({ error: 'Missing guideEmailBody/guideSmsBody' }, { status: 400 });
      }
      const phase1Default: Phase1Default = { guideEmailBody: body.guideEmailBody, guideSmsBody: body.guideSmsBody };

      const { error } = await supabaseAdmin
        .from('booking_system_stage_defaults')
        .upsert(
          { stage_key: stageKey, steps_json: phase1Default, updated_at: updatedAt, updated_by: actingName },
          { onConflict: 'stage_key' },
        );
      if (error) {
        return NextResponse.json({ error: `Failed to publish default: ${error.message}` }, { status: 500 });
      }
      return NextResponse.json({ ok: true, stageKey, ...phase1Default, updatedAt });
    }

    if (!Array.isArray(body.steps)) {
      return NextResponse.json({ error: 'Missing steps' }, { status: 400 });
    }
    // Published defaults never carry over per-row DB ids — they get fresh
    // ids wherever they're later inserted for a resetting venue.
    const stepsJson: StepConfig[] = body.steps.map((s, i) => ({ ...s, id: undefined, step_order: i }));

    const { error } = await supabaseAdmin
      .from('booking_system_stage_defaults')
      .upsert(
        {
          stage_key:  stageKey,
          steps_json: stepsJson,
          updated_at: updatedAt,
          updated_by: actingName,
        },
        { onConflict: 'stage_key' },
      );

    if (error) {
      return NextResponse.json({ error: `Failed to publish default: ${error.message}` }, { status: 500 });
    }

    return NextResponse.json({ ok: true, stageKey, steps: stepsJson, updatedAt });
  }

  if (body.action === 'reset') {
    const { data: defaultRow, error: fetchErr } = await supabaseAdmin
      .from('booking_system_stage_defaults')
      .select('steps_json, updated_at')
      .eq('stage_key', stageKey)
      .maybeSingle();

    if (fetchErr) {
      return NextResponse.json({ error: `Failed to load default template: ${fetchErr.message}` }, { status: 500 });
    }
    if (!defaultRow) {
      return NextResponse.json({ error: 'No default template has been published for this stage yet' }, { status: 404 });
    }

    if (stageKey === 'phase1') {
      const { guideEmailBody, guideSmsBody } = (defaultRow.steps_json as Phase1Default) ?? { guideEmailBody: '', guideSmsBody: '' };

      // Writes ONLY the two body fields — never the on/off toggle columns
      // (booking_guide_email_enabled / booking_guide_sms_enabled).
      const { error: updateErr } = await supabaseAdmin
        .from('venues')
        .update({ booking_guide_email_body: guideEmailBody, booking_guide_sms_body: guideSmsBody })
        .eq('id', venueId);

      if (updateErr) {
        return NextResponse.json({ error: `Failed to reset guide delivery copy: ${updateErr.message}` }, { status: 500 });
      }

      return NextResponse.json({
        ok: true,
        stageKey,
        guideEmailBody,
        guideSmsBody,
        defaultUpdatedAt: defaultRow.updated_at,
      });
    }

    const defaultSteps = (defaultRow.steps_json as StepConfig[]) ?? [];
    if (!isAutomationStageKey(stageKey)) {
      return NextResponse.json({ error: 'Unsupported stageKey' }, { status: 400 });
    }
    const automationName = STAGE_KEY_TO_AUTOMATION_NAME[stageKey];
    const { triggerType, triggerConfig } = await creationDefaultsForStage(venueId, stageKey);

    try {
      const { automationId, automationActive } = await replaceAutomationStepsOnly(
        venueId, automationName, triggerType, defaultSteps, triggerConfig,
      );

      const { data: stepRows } = await supabaseAdmin
        .from('marketing_automation_steps')
        .select('id, step_order, step_type, config_json')
        .eq('automation_id', automationId)
        .order('step_order', { ascending: true });

      return NextResponse.json({
        ok: true,
        stageKey,
        steps: formatStepRows(stepRows ?? []),
        automationId,
        automationActive,
        defaultUpdatedAt: defaultRow.updated_at,
      });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to reset stage' }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'Invalid action — expected "publish" or "reset"' }, { status: 400 });
}
