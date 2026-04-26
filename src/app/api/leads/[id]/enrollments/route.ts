import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/leads/[id]/enrollments
 * Returns all workflow enrollments for a specific lead, including the
 * automation name and the current step info so the UI can render progress pills.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: leadId } = await context.params;

  // Fetch enrollments joined with automation name and step count
  const { data: enrollments, error } = await supabaseAdmin
    .from('marketing_automation_enrollments')
    .select(`
      id,
      status,
      current_step_index,
      enrolled_at,
      completed_at,
      next_run_at,
      last_error,
      automation_id,
      marketing_automations!inner (
        id,
        name,
        status
      )
    `)
    .eq('venue_id', venueId)
    .eq('lead_id', leadId)
    .order('enrolled_at', { ascending: false });

  if (error) {
    console.error('[GET /api/leads/[id]/enrollments]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Also get step counts per automation so we can show "step X of Y"
  const automationIds = [...new Set((enrollments ?? []).map((e) => (e as { automation_id: string }).automation_id))];
  const stepCounts: Record<string, number> = {};
  if (automationIds.length > 0) {
    const { data: steps } = await supabaseAdmin
      .from('marketing_automation_steps')
      .select('automation_id')
      .in('automation_id', automationIds);
    for (const row of steps ?? []) {
      const aid = (row as { automation_id: string }).automation_id;
      stepCounts[aid] = (stepCounts[aid] ?? 0) + 1;
    }
  }

  const rows = (enrollments ?? []).map((e) => {
    const en = e as {
      id: string;
      status: string;
      current_step_index: number;
      enrolled_at: string;
      completed_at: string | null;
      next_run_at: string | null;
      last_error: string | null;
      automation_id: string;
      marketing_automations: { id: string; name: string; status: string } | { id: string; name: string; status: string }[];
    };
    const auto = Array.isArray(en.marketing_automations)
      ? en.marketing_automations[0]
      : en.marketing_automations;
    return {
      id: en.id,
      status: en.status,
      current_step_index: en.current_step_index,
      total_steps: stepCounts[en.automation_id] ?? 0,
      enrolled_at: en.enrolled_at,
      completed_at: en.completed_at,
      next_run_at: en.next_run_at,
      last_error: en.last_error,
      automation_id: en.automation_id,
      automation_name: auto?.name ?? 'Workflow',
      automation_status: auto?.status ?? 'draft',
    };
  });

  return NextResponse.json({ enrollments: rows });
}
