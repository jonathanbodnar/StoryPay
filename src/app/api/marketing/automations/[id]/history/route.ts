import { NextRequest, NextResponse } from 'next/server';
import { getVenueId } from '@/lib/auth-helpers';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/marketing/automations/[id]/history
// Returns enrollment history for a workflow — all contacts that have
// entered this workflow (active, completed, failed, cancelled).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const { data: auto } = await supabaseAdmin
    .from('marketing_automations')
    .select('id')
    .eq('id', id)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!auto) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const url = new URL(request.url);
  const status = url.searchParams.get('status') ?? '';
  const limit  = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 100)));

  let query = supabaseAdmin
    .from('marketing_automation_enrollments')
    .select('id, lead_id, status, current_step_index, started_at, completed_at, next_run_at, last_error, leads(id, first_name, last_name, email, name)')
    .eq('automation_id', id)
    .eq('venue_id', venueId)
    .order('started_at', { ascending: false })
    .limit(limit);

  if (status && status !== 'all') query = query.eq('status', status);

  const { data: rows, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const history = (rows ?? []).map((r) => {
    const rawLead = r.leads as unknown;
    const lead = (Array.isArray(rawLead) ? rawLead[0] : rawLead) as {
      id: string; first_name?: string | null; last_name?: string | null;
      email?: string | null; name?: string | null;
    } | null;
    return {
      id: r.id as string,
      lead_id: (r.lead_id as string) ?? null,
      first_name: lead?.first_name || lead?.name?.split(' ')[0] || '—',
      last_name:  lead?.last_name  || '',
      email:      lead?.email      || '—',
      status:     r.status         as string,
      current_step_index: r.current_step_index as number,
      started_at:   r.started_at   as string,
      completed_at: r.completed_at as string | null,
      next_run_at:  r.next_run_at  as string | null,
      last_error:   r.last_error   as string | null,
    };
  });

  return NextResponse.json({ history });
}
