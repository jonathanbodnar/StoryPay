import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET() {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;

  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [totalResult, statusCounts, revenueResult, customerResult, allProposals] = await Promise.all([
    supabaseAdmin
      .from('proposals')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', venueId),

    supabaseAdmin
      .from('proposals')
      .select('status')
      .eq('venue_id', venueId),

    supabaseAdmin
      .from('proposals')
      .select('price')
      .eq('venue_id', venueId)
      .eq('status', 'paid'),

    supabaseAdmin
      .from('proposals')
      .select('customer_email')
      .eq('venue_id', venueId),

    supabaseAdmin
      .from('proposals')
      .select('status, price, created_at, paid_at')
      .eq('venue_id', venueId),
  ]);

  const totalRevenue = (revenueResult.data ?? []).reduce(
    (sum, row) => sum + (row.price ?? 0),
    0
  );

  const activeProposals = totalResult.count ?? 0;

  const uniqueEmails = new Set(
    (customerResult.data ?? []).map((r) => r.customer_email)
  );
  const customerCount = uniqueEmails.size;

  const pendingPayments = (statusCounts.data ?? []).filter(
    (r) => r.status === 'sent' || r.status === 'opened'
  ).length;

  const statusBreakdown: Record<string, number> = {};
  for (const row of statusCounts.data ?? []) {
    const s = row.status || 'unknown';
    statusBreakdown[s] = (statusBreakdown[s] || 0) + 1;
  }

  const monthlyData: Record<string, { revenue: number; proposals: number }> = {};
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = d.toISOString().slice(0, 7);
    monthlyData[key] = { revenue: 0, proposals: 0 };
  }

  for (const p of allProposals.data ?? []) {
    const dateStr = p.paid_at || p.created_at;
    if (!dateStr) continue;
    const month = dateStr.slice(0, 7);
    if (monthlyData[month]) {
      monthlyData[month].proposals += 1;
      if (p.status === 'paid') {
        monthlyData[month].revenue += p.price || 0;
      }
    }
  }

  const monthlyChart = Object.entries(monthlyData).map(([month, data]) => ({
    month,
    label: new Date(month + '-15').toLocaleDateString('en-US', { month: 'short' }),
    revenue: data.revenue,
    proposals: data.proposals,
  }));

  return NextResponse.json({
    totalRevenue,
    activeProposals,
    customerCount,
    pendingPayments,
    statusBreakdown,
    monthlyChart,
  });
}
