import { NextRequest, NextResponse } from 'next/server';
import { getVenueId } from '@/lib/auth-helpers';
import { supabaseAdmin } from '@/lib/supabase';
import type { AutomationTriggerConfig, AutomationTriggerType } from '@/lib/marketing-email-schema';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type StepIn = { step_order: number; step_type: 'delay' | 'send_email'; config: Record<string, unknown> };

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const { data: auto, error } = await supabaseAdmin
    .from('marketing_automations')
    .select('*')
    .eq('id', id)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!auto) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { data: steps } = await supabaseAdmin
    .from('marketing_automation_steps')
    .select('id, step_order, step_type, config_json')
    .eq('automation_id', id)
    .order('step_order', { ascending: true });
  return NextResponse.json({ automation: auto, steps: steps ?? [] });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  let body: {
    name?: string;
    status?: 'draft' | 'active' | 'paused';
    triggerType?: AutomationTriggerType;
    triggerConfig?: AutomationTriggerConfig;
    steps?: StepIn[] | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { data: existing, error: ex0 } = await supabaseAdmin
    .from('marketing_automations')
    .select('id, status')
    .eq('id', id)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (ex0 || !existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.name === 'string') {
    const n = body.name.trim();
    if (!n) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 });
    patch.name = n;
  }
  if (body.status === 'draft' || body.status === 'active' || body.status === 'paused') {
    patch.status = body.status;
  }
  if (body.triggerType) patch.trigger_type = body.triggerType;
  if (body.triggerConfig !== undefined) patch.trigger_config = body.triggerConfig;

  const stepsProvided = body.steps !== undefined && body.steps !== null;
  if (Object.keys(patch).length > 1) {
    const { error } = await supabaseAdmin.from('marketing_automations').update(patch).eq('id', id).eq('venue_id', venueId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (stepsProvided) {
    const { error } = await supabaseAdmin
      .from('marketing_automations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('venue_id', venueId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (stepsProvided) {
    await supabaseAdmin.from('marketing_automation_steps').delete().eq('automation_id', id);
    if (body.steps!.length > 0) {
      const rows = body.steps!.map((s) => ({
        automation_id: id,
        step_order: s.step_order,
        step_type: s.step_type,
        config_json: s.config ?? {},
      }));
      const { error: se } = await supabaseAdmin.from('marketing_automation_steps').insert(rows);
      if (se) return NextResponse.json({ error: se.message }, { status: 500 });
    }
  }

  const { data: auto } = await supabaseAdmin.from('marketing_automations').select('*').eq('id', id).single();
  const { data: steps } = await supabaseAdmin
    .from('marketing_automation_steps')
    .select('id, step_order, step_type, config_json')
    .eq('automation_id', id)
    .order('step_order', { ascending: true });
  return NextResponse.json({ automation: auto, steps: steps ?? [] });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const { data, error } = await supabaseAdmin
    .from('marketing_automations')
    .delete()
    .eq('id', id)
    .eq('venue_id', venueId)
    .select('id')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
