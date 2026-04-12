import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

async function getVenueId() {
  const c = await cookies();
  return c.get('venue_id')?.value;
}

const STEPS = [
  'payment_processing',
  'first_customer',
  'first_proposal',
  'branding',
  'email_templates',
  'team_member',
] as const;

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: venue, error: venueError } = await supabaseAdmin
    .from('venues')
    .select('*')
    .eq('id', venueId)
    .single();

  if (venueError || !venue) {
    console.error('[onboarding] venue fetch error:', venueError?.message, 'venueId:', venueId);
    return NextResponse.json({ error: 'Venue not found', detail: venueError?.message }, { status: 404 });
  }

  // Only manually-checked steps count — no auto-detection
  const { data: stepRows } = await supabaseAdmin
    .from('venue_onboarding_steps')
    .select('step, completed_at')
    .eq('venue_id', venueId);

  const completedStepSet = new Set((stepRows || []).map((r: { step: string }) => r.step));

  const steps = STEPS.map(id => ({ id, completed: completedStepSet.has(id) }));
  const completedCount = steps.filter(s => s.completed).length;
  const allComplete = completedCount === STEPS.length;

  return NextResponse.json({
    steps,
    completedCount,
    totalSteps: STEPS.length,
    dismissed: venue.onboarding_checklist_dismissed  ?? false,
    completed: allComplete || (venue.onboarding_checklist_completed ?? false),
    venueName: venue.name,
  });
}

export async function POST(req: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();

  if (body.action === 'dismiss') {
    await supabaseAdmin
      .from('venues')
      .update({ onboarding_checklist_dismissed: true })
      .eq('id', venueId);
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'reset') {
    await supabaseAdmin
      .from('venues')
      .update({ onboarding_checklist_dismissed: false, onboarding_checklist_completed: false })
      .eq('id', venueId);
    await supabaseAdmin
      .from('venue_onboarding_steps')
      .delete()
      .eq('venue_id', venueId);
    return NextResponse.json({ ok: true });
  }

  // Toggle a step on
  if (body.step && !body.action) {
    await supabaseAdmin
      .from('venue_onboarding_steps')
      .upsert({ venue_id: venueId, step: body.step, completed_at: new Date().toISOString() });
    return NextResponse.json({ ok: true });
  }

  // Toggle a step off
  if (body.action === 'uncheck_step' && body.step) {
    await supabaseAdmin
      .from('venue_onboarding_steps')
      .delete()
      .eq('venue_id', venueId)
      .eq('step', body.step);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
