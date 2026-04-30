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

  // The new `is_test` / `test_recipient` columns ship with migration 088.
  // We try to select them; if the migration hasn't been applied yet (PostgREST
  // throws an "undefined column" error), we transparently fall back to the
  // pre-088 shape so the UI keeps working instead of crashing.
  const baseColumns = 'id, enrollment_id, lead_id, step_order, step_type, status, error_text, executed_at';
  const newColumns  = 'is_test, test_recipient';
  const leadJoin    = 'leads(id, first_name, last_name, email, name)';

  async function runQuery(includeNew: boolean) {
    const cols = includeNew ? `${baseColumns}, ${newColumns}, ${leadJoin}` : `${baseColumns}, ${leadJoin}`;
    let q = supabaseAdmin
      .from('marketing_automation_execution_logs')
      .select(cols)
      .eq('automation_id', id)
      .eq('venue_id', venueId)
      .order('executed_at', { ascending: false })
      .limit(limit);
    if (status && status !== 'all') q = q.eq('status', status);
    return q;
  }

  let { data: rows, error } = await runQuery(true);
  if (error && /column.*does not exist/i.test(error.message)) {
    ({ data: rows, error } = await runQuery(false));
  }

  if (error) {
    // If the table doesn't exist yet (migration 067 not applied) return empty
    // instead of a 500 so the UI shows the empty state rather than crashing.
    if (/relation.*does not exist/i.test(error.message)) {
      return NextResponse.json({ logs: [], hint: 'Run migration 067 to enable execution logs.' });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const logs = (rows ?? []).map((r) => {
    const row = r as unknown as {
      id: string; enrollment_id: string | null; lead_id: string | null;
      step_order: number | null; step_type: string | null;
      status: string; error_text: string | null; executed_at: string;
      is_test?: boolean; test_recipient?: string | null;
      leads?: unknown;
    };
    const rawLead = row.leads;
    const lead = (Array.isArray(rawLead) ? rawLead[0] : rawLead) as {
      id: string; first_name?: string | null; last_name?: string | null;
      email?: string | null; name?: string | null;
    } | null;
    return {
      id:            row.id,
      enrollment_id: row.enrollment_id,
      lead_id:       row.lead_id,
      first_name:    lead?.first_name || lead?.name?.split(' ')[0] || '—',
      last_name:     lead?.last_name  || '',
      email:         lead?.email      || '—',
      step_order:    row.step_order,
      step_type:     row.step_type,
      status:        row.status,
      error_text:    row.error_text,
      executed_at:   row.executed_at,
      is_test:       row.is_test       === true,
      test_recipient: row.test_recipient ?? null,
    };
  });

  return NextResponse.json({ logs });
}
