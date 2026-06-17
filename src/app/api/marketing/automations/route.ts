import { NextRequest, NextResponse } from 'next/server';
import { getVenueId } from '@/lib/auth-helpers';
import { supabaseAdmin } from '@/lib/supabase';
import type { AutomationTriggerConfig, AutomationTriggerType } from '@/lib/marketing-email-schema';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data, error } = await supabaseAdmin
    .from('marketing_automations')
    .select('id, name, status, trigger_type, trigger_config, created_at, updated_at')
    .eq('venue_id', venueId)
    .order('updated_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ automations: data ?? [] });
}

type StepIn = {
  step_order: number;
  step_type: 'delay' | 'send_email' | 'send_sms' | 'add_tag' | 'remove_tag' | 'change_stage';
  config: Record<string, unknown>;
};

const VALID_TRIGGER_TYPES: AutomationTriggerType[] = [
  'tag_added', 'stage_changed', 'trigger_link_click',
  'wedding_date_followup', 'proposal_paid', 'form_submitted',
];

export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: {
    name?: string;
    triggerType?: AutomationTriggerType | null;
    triggerConfig?: AutomationTriggerConfig;
    steps?: StepIn[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

  // triggerType is optional — workflows can start with no trigger configured.
  const triggerType = body.triggerType ?? null;
  if (triggerType !== null && !VALID_TRIGGER_TYPES.includes(triggerType)) {
    return NextResponse.json({ error: 'Invalid triggerType' }, { status: 400 });
  }

  let triggerConfig = body.triggerConfig ?? {};
  if (triggerType === 'wedding_date_followup') {
    const d = Number((triggerConfig as { days_after_wedding?: unknown }).days_after_wedding ?? 0);
    if (!Number.isFinite(d) || d < 0 || d > 3650) {
      return NextResponse.json({ error: 'days_after_wedding must be between 0 and 3650' }, { status: 400 });
    }
    triggerConfig = { days_after_wedding: Math.floor(d) };
  }
  if (triggerType === 'proposal_paid') triggerConfig = {};
  if (triggerType === 'form_submitted') {
    const raw = (triggerConfig as { form_ids?: unknown }).form_ids;
    const ids = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
    triggerConfig = { form_ids: ids };
  }

  // Attempt insert with nullable trigger_type (requires migration 066).
  // If the column still has a NOT NULL constraint, fall back to a placeholder
  // so workflow creation never hard-fails due to a pending migration.
  let { data: auto, error } = await supabaseAdmin
    .from('marketing_automations')
    .insert({
      venue_id: venueId,
      name,
      status: 'draft',
      trigger_type: triggerType,
      trigger_config: triggerConfig,
    })
    .select('*')
    .single();

  if (error && /not.null constraint/i.test(error.message) && triggerType === null) {
    // Migration 066 not yet applied — insert a placeholder trigger that the
    // builder UI treats as "unset" (trigger_config.__placeholder = true).
    const fallback = await supabaseAdmin
      .from('marketing_automations')
      .insert({
        venue_id: venueId,
        name,
        status: 'draft',
        trigger_type: 'tag_added' as AutomationTriggerType,
        trigger_config: { __placeholder: true },
      })
      .select('*')
      .single();
    auto  = fallback.data;
    error = fallback.error;
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Analytics: venue creates a marketing automation (feature adoption).
  void import('@/lib/analytics')
    .then(({ trackEvent }) => trackEvent({
      event: 'automation_created', kind: 'auto', venueId,
      label: name, properties: { trigger_type: triggerType },
    }))
    .catch(() => { /* non-fatal */ });
  const steps = Array.isArray(body.steps) ? body.steps : [];
  if (steps.length > 0) {
    const rows = steps.map((s) => ({
      automation_id: auto.id,
      step_order: s.step_order,
      step_type: s.step_type,
      config_json: s.config ?? {},
    }));
    const { error: se } = await supabaseAdmin.from('marketing_automation_steps').insert(rows);
    if (se) {
      await supabaseAdmin.from('marketing_automations').delete().eq('id', auto.id);
      return NextResponse.json({ error: se.message }, { status: 500 });
    }
  }
  return NextResponse.json({ automation: auto });
}
