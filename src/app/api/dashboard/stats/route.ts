import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;

  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const from = searchParams.get('from'); // ISO date string or null
  const to = searchParams.get('to');     // ISO date string or null

  // All proposals in date range (for revenue, status, chart)
  let proposalsQuery = supabaseAdmin
    .from('proposals')
    .select('status, price, created_at, paid_at, customer_email')
    .eq('venue_id', venueId);
  if (from) proposalsQuery = proposalsQuery.gte('created_at', from);
  if (to)   proposalsQuery = proposalsQuery.lte('created_at', to + 'T23:59:59.999Z');

  const { data: allProposals } = await proposalsQuery;
  const rows = allProposals ?? [];

  // Revenue — paid proposals
  const totalRevenue = rows
    .filter((r) => r.status === 'paid')
    .reduce((sum, r) => sum + (r.price ?? 0), 0);

  // Status breakdown
  const statusBreakdown: Record<string, number> = {};
  for (const r of rows) {
    const s = r.status || 'unknown';
    statusBreakdown[s] = (statusBreakdown[s] || 0) + 1;
  }

  // Active proposals (sent or opened within range)
  const activeProposals = rows.filter(
    (r) => r.status !== 'draft'
  ).length;

  // Pending payments
  const pendingPayments = rows.filter(
    (r) => r.status === 'sent' || r.status === 'opened'
  ).length;

  // Failed payments
  const failedPayments = rows.filter(
    (r) => r.status === 'failed' || r.status === 'declined'
  ).length;

  // Refunded transactions
  const refundedCount = rows.filter((r) => r.status === 'refunded').length;
  const refundedAmount = rows
    .filter((r) => r.status === 'refunded')
    .reduce((sum, r) => sum + (r.price ?? 0), 0);

  // Unique customers
  const uniqueEmails = new Set(rows.map((r) => r.customer_email).filter(Boolean));
  const customerCount = uniqueEmails.size;

  // Monthly chart — always show relevant months for the selected range
  // Determine start/end months
  const now = new Date();
  const rangeStart = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const rangeEnd   = to   ? new Date(to)   : now;

  // Build month buckets between rangeStart and rangeEnd
  const monthlyData: Record<string, { revenue: number; proposals: number }> = {};
  const cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
  while (cursor <= rangeEnd) {
    const key = cursor.toISOString().slice(0, 7);
    monthlyData[key] = { revenue: 0, proposals: 0 };
    cursor.setMonth(cursor.getMonth() + 1);
  }
  // Cap to 12 buckets max for readability
  const allKeys = Object.keys(monthlyData).sort();
  const cappedKeys = allKeys.slice(-12);
  const cappedData: Record<string, { revenue: number; proposals: number }> = {};
  for (const k of cappedKeys) cappedData[k] = monthlyData[k];

  for (const p of rows) {
    const dateStr = p.paid_at || p.created_at;
    if (!dateStr) continue;
    const month = dateStr.slice(0, 7);
    if (cappedData[month]) {
      cappedData[month].proposals += 1;
      if (p.status === 'paid') cappedData[month].revenue += p.price || 0;
    }
  }

  const monthlyChart = Object.entries(cappedData).map(([month, data]) => ({
    month,
    label: new Date(month + '-15').toLocaleDateString('en-US', { month: 'short', year: cappedKeys.length > 6 ? '2-digit' : undefined }),
    revenue: data.revenue,
    proposals: data.proposals,
  }));

  // Trends: compare current period vs equivalent prior period
  const periodMs = rangeEnd.getTime() - rangeStart.getTime();
  const prevEnd   = new Date(rangeStart.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - periodMs);
  const prevStartStr = prevStart.toISOString();
  const prevEndStr   = prevEnd.toISOString();

  let prevQuery = supabaseAdmin
    .from('proposals')
    .select('status, price, created_at')
    .eq('venue_id', venueId)
    .gte('created_at', prevStartStr)
    .lte('created_at', prevEndStr);

  const { data: prevProposals } = await prevQuery;
  const prevRows = prevProposals ?? [];

  const prevRevenue   = prevRows.filter((r) => r.status === 'paid').reduce((s, r) => s + (r.price ?? 0), 0);
  const prevProposalCount = prevRows.length;

  const revenueChange   = prevRevenue       > 0 ? ((totalRevenue   - prevRevenue)       / prevRevenue)       * 100 : 0;
  const proposalChange  = prevProposalCount > 0 ? ((activeProposals - prevProposalCount) / prevProposalCount) * 100 : 0;

  return NextResponse.json({
    totalRevenue,
    activeProposals,
    customerCount,
    pendingPayments,
    failedPayments,
    refundedCount,
    refundedAmount,
    statusBreakdown,
    monthlyChart,
    trends: {
      revenueChange,
      proposalChange,
      thisMonthRevenue: totalRevenue,
      lastMonthRevenue: prevRevenue,
      thisMonthProposals: activeProposals,
      lastMonthProposals: prevProposalCount,
    },
  });
}
