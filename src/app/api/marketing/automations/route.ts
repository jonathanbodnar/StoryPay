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

type StepIn = { step_order: number; step_type: 'delay' | 'send_email'; config: Record<string, unknown> };

export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: {
    name?: string;
    triggerType?: AutomationTriggerType;
    triggerConfig?: AutomationTriggerConfig;
    steps?: StepIn[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const triggerType = body.triggerType;
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  if (
    triggerType !== 'tag_added' &&
    triggerType !== 'stage_changed' &&
    triggerType !== 'trigger_link_click'
  ) {
    return NextResponse.json({ error: 'Invalid triggerType' }, { status: 400 });
  }
  const { data: auto, error } = await supabaseAdmin
    .from('marketing_automations')
    .insert({
      venue_id: venueId,
      name,
      status: 'draft',
      trigger_type: triggerType,
      trigger_config: body.triggerConfig ?? {},
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
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
