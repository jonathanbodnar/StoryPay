import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

function pctDelta(prev: number, curr: number): number {
  if (prev <= 0) return 0;
  return ((curr - prev) / prev) * 100;
}

async function countLeads(venueId: string, startIso: string | null, endIso: string | null): Promise<number> {
  let q = supabaseAdmin.from('leads').select('*', { count: 'exact', head: true }).eq('venue_id', venueId);
  if (startIso) q = q.gte('created_at', startIso);
  if (endIso) q = q.lte('created_at', endIso);
  const { count, error } = await q;
  if (error) console.error('[dashboard/stats] leads count', error);
  return count ?? 0;
}

async function countVenueCustomers(venueId: string, startIso: string | null, endIso: string | null): Promise<number> {
  let q = supabaseAdmin.from('venue_customers').select('*', { count: 'exact', head: true }).eq('venue_id', venueId);
  if (startIso) q = q.gte('created_at', startIso);
  if (endIso) q = q.lte('created_at', endIso);
  const { count, error } = await q;
  if (error) console.error('[dashboard/stats] venue_customers count', error);
  return count ?? 0;
}

/** Tours and wedding/reception events with start_at in range; excludes cancelled. */
async function countCalendarBookings(
  venueId: string,
  startAtGte: string | null,
  startAtLte: string | null,
): Promise<{ toursBooked: number; weddingsBooked: number }> {
  let q = supabaseAdmin.from('calendar_events').select('event_type, status').eq('venue_id', venueId);
  if (startAtGte) q = q.gte('start_at', startAtGte);
  if (startAtLte) q = q.lte('start_at', startAtLte);
  const { data, error } = await q;
  if (error) {
    console.error('[dashboard/stats] calendar_events', error);
    return { toursBooked: 0, weddingsBooked: 0 };
  }
  let toursBooked = 0;
  let weddingsBooked = 0;
  for (const row of data ?? []) {
    if (row.status === 'cancelled') continue;
    if (row.event_type === 'tour') toursBooked += 1;
    else if (row.event_type === 'wedding' || row.event_type === 'reception') weddingsBooked += 1;
  }
  return { toursBooked, weddingsBooked };
}

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
  const proposalCount = rows.length;

  const revenueChange = pctDelta(prevRevenue, totalRevenue);
  const proposalChange = pctDelta(prevProposalCount, proposalCount);

  const currentCreatedEnd = to ? `${to}T23:59:59.999Z` : null;
  const prevCreatedEnd = prevEndStr;

  const [
    leadCount,
    contactCount,
    { toursBooked, weddingsBooked },
    prevLeadCount,
    prevContactCount,
    prevCal,
  ] = await Promise.all([
    countLeads(venueId, from, currentCreatedEnd),
    countVenueCustomers(venueId, from, currentCreatedEnd),
    countCalendarBookings(venueId, from, currentCreatedEnd),
    countLeads(venueId, prevStartStr, prevCreatedEnd),
    countVenueCustomers(venueId, prevStartStr, prevCreatedEnd),
    countCalendarBookings(venueId, prevStartStr, prevCreatedEnd),
  ]);

  const leadChange = pctDelta(prevLeadCount, leadCount);
  const contactChange = pctDelta(prevContactCount, contactCount);
  const toursChange = pctDelta(prevCal.toursBooked, toursBooked);
  const weddingsChange = pctDelta(prevCal.weddingsBooked, weddingsBooked);

  return NextResponse.json({
    totalRevenue,
    activeProposals,
    proposalCount,
    customerCount,
    leadCount,
    contactCount,
    toursBooked,
    weddingsBooked,
    pendingPayments,
    failedPayments,
    refundedCount,
    refundedAmount,
    statusBreakdown,
    monthlyChart,
    trends: {
      revenueChange,
      proposalChange,
      leadChange,
      contactChange,
      toursChange,
      weddingsChange,
      thisMonthRevenue: totalRevenue,
      lastMonthRevenue: prevRevenue,
      thisMonthProposals: proposalCount,
      lastMonthProposals: prevProposalCount,
    },
  });
}
