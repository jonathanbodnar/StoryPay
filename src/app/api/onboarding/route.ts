import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

async function getVenueId() {
  const c = await cookies();
  return c.get('venue_id')?.value;
}

const STEPS = [
  'profile_branding',
  'email_templates',
  'proposal_template',
  'create_proposal',
  'send_proposal',
  'team_member',
] as const;

type StepId = typeof STEPS[number];

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: venue, error } = await supabaseAdmin
    .from('venues')
    .select('*')
    .eq('id', venueId)
    .single();

  if (error || !venue) {
    console.error('[onboarding] fetch error:', error?.message, 'venueId:', venueId);
    return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  }

  // Steps stored as JSON array on venues row — works in all environments
  const completedSteps: string[] = Array.isArray(venue.onboarding_steps_completed)
    ? venue.onboarding_steps_completed
    : [];

  const steps = STEPS.map(id => ({ id, completed: completedSteps.includes(id) }));
  const completedCount = steps.filter(s => s.completed).length;
  const allComplete = completedCount === STEPS.length;

  return NextResponse.json({
    steps,
    completedCount,
    totalSteps: STEPS.length,
    dismissed: venue.onboarding_checklist_dismissed ?? false,
    completed: allComplete || (venue.onboarding_checklist_completed ?? false),
    venueName: venue.name,
  });
}

export async function POST(req: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as {
    action?: string;
    step?: StepId;
  };

  // First read current steps
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('onboarding_steps_completed, onboarding_checklist_dismissed, onboarding_checklist_completed')
    .eq('id', venueId)
    .single();

  const currentSteps: string[] = Array.isArray(venue?.onboarding_steps_completed)
    ? venue.onboarding_steps_completed
    : [];

  if (body.action === 'dismiss') {
    const { error } = await supabaseAdmin
      .from('venues')
      .update({ onboarding_checklist_dismissed: true })
      .eq('id', venueId);
    if (error) {
      console.error('[onboarding] dismiss error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'reset') {
    const { error } = await supabaseAdmin
      .from('venues')
      .update({
        onboarding_checklist_dismissed: false,
        onboarding_checklist_completed: false,
        onboarding_steps_completed: [],
      })
      .eq('id', venueId);
    if (error) {
      console.error('[onboarding] reset error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  // Check a step on
  if (body.step && !body.action) {
    const updated = currentSteps.includes(body.step)
      ? currentSteps
      : [...currentSteps, body.step];
    const { error } = await supabaseAdmin
      .from('venues')
      .update({ onboarding_steps_completed: updated })
      .eq('id', venueId);
    if (error) {
      console.error('[onboarding] check step error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  // Uncheck a step
  if (body.action === 'uncheck_step' && body.step) {
    const updated = currentSteps.filter(s => s !== body.step);
    const { error } = await supabaseAdmin
      .from('venues')
      .update({ onboarding_steps_completed: updated })
      .eq('id', venueId);
    if (error) {
      console.error('[onboarding] uncheck step error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
