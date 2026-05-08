/**
 * GET  /api/listing/booking-system/step-leads
 *   Returns all active enrollments for this venue's Speed-to-Lead automation,
 *   grouped by current_step_index, enriched with lead name + email.
 *   Used by the sequence editor to show who is waiting at each step.
 *
 * POST /api/listing/booking-system/step-leads
 *   Force-advances one enrollment to the next step immediately.
 *   Body: { enrollmentId: string }
 *
 *   "Force next step" means:
 *     - Advance current_step_index by 1
 *     - Set next_run_at to NOW() so the cron picks it up on the next tick
 *     - If this was the final step, mark the enrollment completed
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';
export const runtime  = 'nodejs';

const STL_NAME = 'Speed to Lead — Booking System';

export interface StepLeadInfo {
  enrollment_id:      string;
  lead_id:            string;
  first_name:         string | null;
  last_name:          string | null;
  email:              string | null;
  phone:              string | null;
  current_step_index: number;
  next_run_at:        string | null;
}

export interface StepLeadsPayload {
  byStep:         Record<number, StepLeadInfo[]>;
  total:          number;
  automationId:   string | null;
  stepCount:      number;
}

// ── GET ──────────────────────────────────────────────────────────────────────

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Find the automation
  const { data: automation } = await supabaseAdmin
    .from('marketing_automations')
    .select('id')
    .eq('venue_id', venueId)
    .eq('name', STL_NAME)
    .maybeSingle();

  if (!automation) {
    return NextResponse.json({ byStep: {}, total: 0, automationId: null, stepCount: 0 } satisfies StepLeadsPayload);
  }

  // Count steps so we know the total for "is this the last step?" check
  const { count: stepCount } = await supabaseAdmin
    .from('marketing_automation_steps')
    .select('*', { count: 'exact', head: true })
    .eq('automation_id', automation.id);

  // All active enrollments
  const { data: enrollments } = await supabaseAdmin
    .from('marketing_automation_enrollments')
    .select('id, lead_id, current_step_index, next_run_at')
    .eq('automation_id', automation.id)
    .eq('status', 'active')
    .order('current_step_index', { ascending: true });

  if (!enrollments || enrollments.length === 0) {
    return NextResponse.json({
      byStep: {}, total: 0,
      automationId: automation.id,
      stepCount: stepCount ?? 0,
    } satisfies StepLeadsPayload);
  }

  const leadIds = [...new Set(enrollments.map((e: { lead_id: string }) => e.lead_id))];

  // Enrich with lead data
  const { data: leads } = await supabaseAdmin
    .from('leads')
    .select('id, first_name, last_name, name, email, phone')
    .in('id', leadIds);

  const leadById = new Map<string, { first_name: string | null; last_name: string | null; name: string | null; email: string | null; phone: string | null }>();
  for (const l of (leads ?? []) as Array<{ id: string; first_name: string | null; last_name: string | null; name: string | null; email: string | null; phone: string | null }>) {
    leadById.set(l.id, l);
  }

  const byStep: Record<number, StepLeadInfo[]> = {};
  for (const e of enrollments as Array<{ id: string; lead_id: string; current_step_index: number; next_run_at: string | null }>) {
    const l = leadById.get(e.lead_id);
    const fn = l?.first_name ?? l?.name?.split(' ')[0] ?? null;
    const info: StepLeadInfo = {
      enrollment_id:      e.id,
      lead_id:            e.lead_id,
      first_name:         fn,
      last_name:          l?.last_name ?? null,
      email:              l?.email ?? null,
      phone:              l?.phone ?? null,
      current_step_index: e.current_step_index,
      next_run_at:        e.next_run_at,
    };
    (byStep[e.current_step_index] ??= []).push(info);
  }

  return NextResponse.json({
    byStep,
    total:       enrollments.length,
    automationId: automation.id,
    stepCount:   stepCount ?? 0,
  } satisfies StepLeadsPayload);
}

// ── POST (force advance) ──────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { enrollmentId?: string };
  if (!body.enrollmentId) {
    return NextResponse.json({ error: 'Missing enrollmentId' }, { status: 400 });
  }

  // Verify this enrollment belongs to this venue
  const { data: enrollment } = await supabaseAdmin
    .from('marketing_automation_enrollments')
    .select('id, automation_id, current_step_index, status')
    .eq('id', body.enrollmentId)
    .eq('venue_id', venueId)
    .single();

  if (!enrollment) {
    return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 });
  }
  if (enrollment.status !== 'active') {
    return NextResponse.json({ error: 'Enrollment is not active' }, { status: 409 });
  }

  // Count total steps to detect last-step completion
  const { count: stepCount } = await supabaseAdmin
    .from('marketing_automation_steps')
    .select('*', { count: 'exact', head: true })
    .eq('automation_id', enrollment.automation_id);

  const nextIndex   = (enrollment.current_step_index as number) + 1;
  const isLastStep  = stepCount !== null && nextIndex >= stepCount;

  if (isLastStep) {
    // Mark completed rather than advancing past the end
    await supabaseAdmin
      .from('marketing_automation_enrollments')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', body.enrollmentId);
    return NextResponse.json({ ok: true, action: 'completed', nextIndex });
  }

  // Advance the step and fire immediately (next_run_at = NOW)
  await supabaseAdmin
    .from('marketing_automation_enrollments')
    .update({
      current_step_index: nextIndex,
      next_run_at:        new Date().toISOString(),
      updated_at:         new Date().toISOString(),
    })
    .eq('id', body.enrollmentId);

  return NextResponse.json({ ok: true, action: 'advanced', nextIndex });
}
