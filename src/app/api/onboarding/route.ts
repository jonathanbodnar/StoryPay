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

  // Use select('*') to avoid 404s when specific columns are missing in production
  const { data: venue, error: venueError } = await supabaseAdmin
    .from('venues')
    .select('*')
    .eq('id', venueId)
    .single();

  if (venueError || !venue) {
    console.error('[onboarding] venue fetch error:', venueError?.message, 'venueId:', venueId);
    return NextResponse.json({ error: 'Venue not found', detail: venueError?.message }, { status: 404 });
  }

  // Get manually-completed steps (table may not exist in all envs — handle gracefully)
  const { data: stepRows } = await supabaseAdmin
    .from('venue_onboarding_steps')
    .select('step, completed_at')
    .eq('venue_id', venueId);

  const completedStepSet = new Set((stepRows || []).map((r: { step: string }) => r.step));

  // Auto-detect steps from venue state (use optional chaining for missing columns)
  if (venue.lunarpay_secret_key && venue.lunarpay_merchant_id) completedStepSet.add('payment_processing');
  if (venue.brand_logo_url || venue.brand_color || venue.brand_email) completedStepSet.add('branding');

  // first_proposal: any proposal exists for this venue
  const { count: propCount } = await supabaseAdmin
    .from('proposals')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', venueId);
  if ((propCount ?? 0) > 0) {
    completedStepSet.add('first_proposal');
    completedStepSet.add('first_customer'); // if they sent a proposal, they have a customer
  }

  // first_customer: any proposal with a customer_email
  const { count: custProposals } = await supabaseAdmin
    .from('proposals')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', venueId)
    .not('customer_email', 'is', null);
  if ((custProposals ?? 0) > 0) completedStepSet.add('first_customer');

  // email_templates: any saved template
  const { count: etCount } = await supabaseAdmin
    .from('venue_email_templates')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', venueId);
  if ((etCount ?? 0) > 0) completedStepSet.add('email_templates');

  // team_member: any team member added
  const { count: teamCount } = await supabaseAdmin
    .from('venue_team_members')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', venueId);
  if ((teamCount ?? 0) > 0) completedStepSet.add('team_member');

  const steps = STEPS.map(id => ({ id, completed: completedStepSet.has(id) }));
  const completedCount = steps.filter(s => s.completed).length;
  const allComplete = completedCount === STEPS.length;

  return NextResponse.json({
    steps,
    completedCount,
    totalSteps: STEPS.length,
    dismissed:  venue.onboarding_checklist_dismissed  ?? false,
    completed:  allComplete || (venue.onboarding_checklist_completed ?? false),
    venueName:  venue.name,
  });
}

export async function POST(req: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();

  if (body.action === 'dismiss') {
    const { error } = await supabaseAdmin
      .from('venues')
      .update({ onboarding_checklist_dismissed: true })
      .eq('id', venueId);
    if (error) console.error('[onboarding] dismiss error:', error.message);
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'complete_all') {
    await supabaseAdmin
      .from('venues')
      .update({ onboarding_checklist_completed: true })
      .eq('id', venueId);
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'reset') {
    const { error: venueErr } = await supabaseAdmin
      .from('venues')
      .update({ onboarding_checklist_dismissed: false, onboarding_checklist_completed: false })
      .eq('id', venueId);
    if (venueErr) console.error('[onboarding] reset venue error:', venueErr.message);

    const { error: stepsErr } = await supabaseAdmin
      .from('venue_onboarding_steps')
      .delete()
      .eq('venue_id', venueId);
    if (stepsErr) console.error('[onboarding] reset steps error:', stepsErr.message);

    return NextResponse.json({ ok: true });
  }

  if (body.action === 'uncheck_step' && body.step) {
    await supabaseAdmin
      .from('venue_onboarding_steps')
      .delete()
      .eq('venue_id', venueId)
      .eq('step', body.step);
    return NextResponse.json({ ok: true });
  }

  if (body.step) {
    await supabaseAdmin
      .from('venue_onboarding_steps')
      .upsert({ venue_id: venueId, step: body.step, completed_at: new Date().toISOString() });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
