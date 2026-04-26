import { NextRequest, NextResponse } from 'next/server';
import { getVenueId } from '@/lib/auth-helpers';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/marketing/automations/[id]/logs
// Returns step execution logs for a workflow (most recent first).
// Useful for diagnosing delivery failures, skipped steps, etc.
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

  const url    = new URL(request.url);
  const status = url.searchParams.get('status') ?? '';
  const limit  = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') ?? 100)));

  let query = supabaseAdmin
    .from('marketing_automation_execution_logs')
    .select('id, enrollment_id, lead_id, step_order, step_type, status, error_text, executed_at, leads(id, first_name, last_name, email, name)')
    .eq('automation_id', id)
    .eq('venue_id', venueId)
    .order('executed_at', { ascending: false })
    .limit(limit);

  if (status && status !== 'all') query = query.eq('status', status);

  const { data: rows, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const logs = (rows ?? []).map((r) => {
    const rawLead = r.leads as unknown;
    const lead = (Array.isArray(rawLead) ? rawLead[0] : rawLead) as {
      id: string; first_name?: string | null; last_name?: string | null;
      email?: string | null; name?: string | null;
    } | null;
    return {
      id:            r.id            as string,
      enrollment_id: r.enrollment_id as string | null,
      lead_id:       r.lead_id       as string | null,
      first_name:  lead?.first_name || lead?.name?.split(' ')[0] || '—',
      last_name:   lead?.last_name  || '',
      email:       lead?.email      || '—',
      step_order:  r.step_order  as number | null,
      step_type:   r.step_type   as string | null,
      status:      r.status      as string,
      error_text:  r.error_text  as string | null,
      executed_at: r.executed_at as string,
    };
  });

  return NextResponse.json({ logs });
}
