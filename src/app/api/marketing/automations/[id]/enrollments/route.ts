import { NextRequest, NextResponse } from 'next/server';
import { getVenueId } from '@/lib/auth-helpers';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/marketing/automations/[id]/enrollments
// Returns:
//   counts: { [stepIndex: number]: number }  — active contacts per step
//   list:   contact detail for a specific stepIndex (when ?stepIndex=N is provided)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  // Verify ownership
  const { data: auto } = await supabaseAdmin
    .from('marketing_automations')
    .select('id')
    .eq('id', id)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!auto) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const url = new URL(request.url);
  const stepIndexParam = url.searchParams.get('stepIndex');

  const nowIso = new Date().toISOString();

  if (stepIndexParam !== null) {
    // Detailed list for a specific step (display index).
    // A contact "displays" at step N when:
    //   a) current_step_index = N and not waiting out a future delay, OR
    //   b) current_step_index = N+1 and next_run_at is still in the future
    //      (meaning the delay step at index N hasn't expired yet)
    const stepIndex = Number(stepIndexParam);
    const { data: rows, error } = await supabaseAdmin
      .from('marketing_automation_enrollments')
      .select('id, current_step_index, status, next_run_at, last_error, leads(id, first_name, last_name, email, name)')
      .eq('automation_id', id)
      .in('status', ['active', 'failed'])
      .or(
        `and(current_step_index.eq.${stepIndex},or(next_run_at.is.null,next_run_at.lte.${nowIso})),` +
        `and(current_step_index.eq.${stepIndex + 1},next_run_at.gt.${nowIso})`,
      )
      .order('next_run_at', { ascending: true })
      .limit(200);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const list = (rows ?? []).map((r) => {
      const rawLead = r.leads as unknown;
      const lead = (Array.isArray(rawLead) ? rawLead[0] : rawLead) as { id: string; first_name: string | null; last_name: string | null; email: string | null; name: string | null } | null;
      const nextRunAt = r.next_run_at as string | null;
      const isWaitingForDelay = !!nextRunAt && nextRunAt > nowIso && (r.current_step_index as number) === stepIndex + 1;
      return {
        id: r.id as string,
        stepIndex: isWaitingForDelay ? stepIndex : (r.current_step_index as number),
        status: r.status as string,
        lastError: (r.last_error as string | null) ?? null,
        nextRunAt,
        leadId: lead?.id ?? null,
        firstName: lead?.first_name || lead?.name?.split(' ')[0] || '—',
        lastName: lead?.last_name || '',
        email: lead?.email || '—',
      };
    });
    return NextResponse.json({ list });
  }

  // Counts per step — uses "display index" so the pill sits on the Wait step
  // while the delay hasn't expired, not on the next step.
  const { data: allEnrollments, error } = await supabaseAdmin
    .from('marketing_automation_enrollments')
    .select('current_step_index, next_run_at')
    .eq('automation_id', id)
    .in('status', ['active', 'failed']);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const counts: Record<number, number> = {};
  for (const row of allEnrollments ?? []) {
    let idx = row.current_step_index as number;
    const nextRunAt = row.next_run_at as string | null;
    // If the delay hasn't fired yet, show the pill at the preceding Wait step
    if (nextRunAt && nextRunAt > nowIso && idx > 0) {
      idx = idx - 1;
    }
    counts[idx] = (counts[idx] ?? 0) + 1;
  }
  return NextResponse.json({ counts });
}
