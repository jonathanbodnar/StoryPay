import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

async function getVenueId() {
  const c = await cookies();
  return c.get('venue_id')?.value;
}

// Step IDs and what they require to be "complete"
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

  // Get venue info to auto-detect completed steps
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('lunarpay_secret_key, lunarpay_merchant_id, ghl_connected, onboarding_status, onboarding_checklist_dismissed, onboarding_checklist_completed, brand_logo_url, brand_color, brand_email, name')
    .eq('id', venueId)
    .single();

  if (!venue) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

  // Get manually-completed steps
  const { data: stepRows } = await supabaseAdmin
    .from('venue_onboarding_steps')
    .select('step, completed_at')
    .eq('venue_id', venueId);

  const completedStepSet = new Set((stepRows || []).map((r: { step: string }) => r.step));

  // Auto-detect steps based on venue state
  if (venue.lunarpay_secret_key && venue.lunarpay_merchant_id) completedStepSet.add('payment_processing');
  if (venue.brand_logo_url || venue.brand_color || venue.brand_email) completedStepSet.add('branding');

  // Check if they have any customers
  const { count: custCount } = await supabaseAdmin
    .from('venues') // proxy — we check proposals as proxy
    .select('id', { count: 'exact', head: true })
    .eq('id', venueId);
  if ((custCount ?? 0) > 0) {
    // Check actual customer existence via proposals table (has customer data)
    const { count: propCount } = await supabaseAdmin
      .from('proposals')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', venueId)
      .limit(1);
    if ((propCount ?? 0) > 0) completedStepSet.add('first_proposal');
  }

  // Check for at least one customer in LunarPay context (via proposals table customer data)
  const { count: custProposals } = await supabaseAdmin
    .from('proposals')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', venueId)
    .not('customer_email', 'is', null);
  if ((custProposals ?? 0) > 0) completedStepSet.add('first_customer');

  // Check email templates
  const { count: etCount } = await supabaseAdmin
    .from('venue_email_templates')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', venueId);
  if ((etCount ?? 0) > 0) completedStepSet.add('email_templates');

  // Check team members
  const { count: teamCount } = await supabaseAdmin
    .from('venue_team_members')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', venueId);
  if ((teamCount ?? 0) > 0) completedStepSet.add('team_member');

  const steps = STEPS.map(id => ({
    id,
    completed: completedStepSet.has(id),
  }));

  const completedCount = steps.filter(s => s.completed).length;
  const allComplete = completedCount === STEPS.length;

  return NextResponse.json({
    steps,
    completedCount,
    totalSteps: STEPS.length,
    dismissed: venue.onboarding_checklist_dismissed,
    completed: allComplete || venue.onboarding_checklist_completed,
    venueName: venue.name,
  });
}

// Mark a step as complete, or dismiss / complete the checklist
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

  if (body.action === 'complete_all') {
    await supabaseAdmin
      .from('venues')
      .update({ onboarding_checklist_completed: true })
      .eq('id', venueId);
    return NextResponse.json({ ok: true });
  }

  // Reset: clear dismissed/completed flags and all manual step completions.
  // Does NOT touch any real data (proposals, customers, branding, etc.).
  // Auto-detected completions will still show based on actual account state.
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

  if (body.step) {
    await supabaseAdmin
      .from('venue_onboarding_steps')
      .upsert({ venue_id: venueId, step: body.step, completed_at: new Date().toISOString() });
    return NextResponse.json({ ok: true });
  }

  // Uncheck a manually-checked step
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
