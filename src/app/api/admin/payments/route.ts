import { cookies } from 'next/headers';
import { verifyMasterAdminToken } from '@/lib/admin-token';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

async function verifyAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  return verifyMasterAdminToken(token);
}

/**
 * The dashboard's Pending / Failed payments lists, counted the same way as the
 * boxes (/api/admin/stats): the demo venue left out, proposals created in the
 * date range. Failed includes a Stripe installment that failed every retry.
 */
export async function GET(request: NextRequest) {
  if (!(await verifyAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sp = request.nextUrl.searchParams;
  const status = sp.get('status');
  const from = sp.get('from');
  const to = sp.get('to');

  const { data: demos } = await supabaseAdmin.from('venues').select('id').eq('is_demo', true);
  const notDemo = `(${(demos ?? []).map((d) => d.id).join(',') || '00000000-0000-0000-0000-000000000000'})`;

  const toEnd = to ? `${to}T23:59:59.999Z` : null;
  const proposalsQuery = () => {
    let q = supabaseAdmin
      .from('proposals')
      .select('id, customer_name, customer_email, price, status, created_at, paid_at')
      .not('venue_id', 'in', notDemo)
      .order('created_at', { ascending: false });
    if (from) q = q.gte('created_at', from);
    if (toEnd) q = q.lte('created_at', toEnd);
    return q;
  };

  if (status === 'pending') {
    const { data } = await proposalsQuery().in('status', ['sent', 'opened', 'signed', 'partially_paid']);
    return NextResponse.json(data ?? []);
  }
  if (status !== 'failed') {
    const { data } = await proposalsQuery();
    return NextResponse.json(data ?? []);
  }

  // Failed: declined/failed proposals created in the range, plus proposals
  // whose installment failed in the range (the proposal itself can be older).
  let fq = supabaseAdmin.from('proposal_installments').select('proposal_id').eq('status', 'failed').not('venue_id', 'in', notDemo);
  if (from) fq = fq.gte('updated_at', from);
  if (toEnd) fq = fq.lte('updated_at', toEnd);
  const failedIds = [...new Set(((await fq).data ?? []).map((i) => i.proposal_id as string))];
  const [{ data: declined }, { data: withFailedInstallment }] = await Promise.all([
    proposalsQuery().in('status', ['failed', 'declined']),
    failedIds.length
      ? supabaseAdmin
          .from('proposals')
          .select('id, customer_name, customer_email, price, status, created_at, paid_at')
          .in('id', failedIds)
      : Promise.resolve({ data: [] as { id: string; created_at: string }[] }),
  ]);
  const byId = new Map<string, Record<string, unknown>>();
  for (const r of [...(declined ?? []), ...(withFailedInstallment ?? [])]) byId.set(r.id as string, r);
  const rows = [...byId.values()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return NextResponse.json(rows);
}
