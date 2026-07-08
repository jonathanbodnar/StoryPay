/**
 * Booking System — per-stage "Save as Default" / "Reset to Default".
 *
 * POST /api/listing/booking-system/stage-default
 *
 *   action: 'publish' — { stageKey, steps }
 *     Publishes the CALLING venue's current step content for `stageKey` as
 *     the new global default template, stored in
 *     `booking_system_stage_defaults`. ONLY the Demo Venue may do this
 *     (enforced here, not just hidden client-side).
 *
 *   action: 'reset' — { stageKey }
 *     Looks up the published default steps for `stageKey` and overwrites
 *     ONLY the calling venue's automation step content for the matching
 *     `marketing_automations` row (delete + reinsert
 *     `marketing_automation_steps`, same pattern as PATCH in the parent
 *     route / migrations/162). Never touches that automation's on/off
 *     status or trigger wiring beyond self-healing on first creation — see
 *     `replaceAutomationStepsOnly`.
 *
 * Stage 1 (guide delivery) has no entry in `STAGE_KEY_TO_AUTOMATION_NAME` —
 * it's just two on/off toggles + a fixed body each, no StepConfig[] sequence,
 * so it's not supported by either action here.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId, getMemberName } from '@/lib/auth-helpers';
import {
  STAGE_KEY_TO_AUTOMATION_NAME, DEMO_VENUE_NAME,
  PHASE4_STAGE_NAME, PHASE5_STAGE_NAME,
  resolveDefaultStageIdByName, replaceAutomationStepsOnly, formatStepRows,
  type StepConfig, type StageKey,
} from '@/app/api/listing/booking-system/route';

export const dynamic = 'force-dynamic';
export const runtime  = 'nodejs';

function isValidStageKey(key: unknown): key is StageKey {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(STAGE_KEY_TO_AUTOMATION_NAME, key);
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
async function creationDefaultsForStage(venueId: string, stageKey: StageKey): Promise<{
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
  return { triggerType: 'form_submitted' };
}

export async function POST(req: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { action?: string; stageKey?: string; steps?: StepConfig[] };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (!isValidStageKey(body.stageKey)) {
    return NextResponse.json({ error: 'Invalid or unsupported stageKey' }, { status: 400 });
  }
  const stageKey = body.stageKey;

  if (body.action === 'publish') {
    if (!Array.isArray(body.steps)) {
      return NextResponse.json({ error: 'Missing steps' }, { status: 400 });
    }
    // Server-side enforcement — publish is Demo-Venue-only regardless of
    // what the client sends/hides.
    if (!(await isDemoVenue(venueId))) {
      return NextResponse.json({ error: 'Only the Demo Venue can publish a default template' }, { status: 403 });
    }

    const actingName = (await getMemberName()) ?? DEMO_VENUE_NAME;
    // Published defaults never carry over per-row DB ids — they get fresh
    // ids wherever they're later inserted for a resetting venue.
    const stepsJson: StepConfig[] = body.steps.map((s, i) => ({ ...s, id: undefined, step_order: i }));
    const updatedAt = new Date().toISOString();

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

    const defaultSteps = (defaultRow.steps_json as StepConfig[]) ?? [];
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
