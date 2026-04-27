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

  if (stepIndexParam !== null) {
    // Detailed list for a specific step
    const stepIndex = Number(stepIndexParam);
    const { data: rows, error } = await supabaseAdmin
      .from('marketing_automation_enrollments')
      .select('id, current_step_index, status, next_run_at, last_error, leads(id, first_name, last_name, email, name)')
      .eq('automation_id', id)
      .eq('current_step_index', stepIndex)
      .in('status', ['active', 'failed'])
      .order('next_run_at', { ascending: true })
      .limit(200);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const list = (rows ?? []).map((r) => {
      const rawLead = r.leads as unknown;
      const lead = (Array.isArray(rawLead) ? rawLead[0] : rawLead) as { id: string; first_name: string | null; last_name: string | null; email: string | null; name: string | null } | null;
      return {
        id: r.id as string,
        stepIndex: r.current_step_index as number,
        status: r.status as string,
        lastError: (r.last_error as string | null) ?? null,
        nextRunAt: r.next_run_at as string | null,
        leadId: lead?.id ?? null,
        firstName: lead?.first_name || lead?.name?.split(' ')[0] || '—',
        lastName: lead?.last_name || '',
        email: lead?.email || '—',
      };
    });
    return NextResponse.json({ list });
  }

  // Counts per step
  const { data: allEnrollments, error } = await supabaseAdmin
    .from('marketing_automation_enrollments')
    .select('current_step_index')
    .eq('automation_id', id)
    .in('status', ['active', 'failed']);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const counts: Record<number, number> = {};
  for (const row of allEnrollments ?? []) {
    const idx = row.current_step_index as number;
    counts[idx] = (counts[idx] ?? 0) + 1;
  }
  return NextResponse.json({ counts });
}
