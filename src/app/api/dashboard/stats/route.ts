import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

function pctDelta(prev: number, curr: number): number {
  if (prev <= 0) return 0;
  return ((curr - prev) / prev) * 100;
}

async function countLeads(venueId: string, startIso: string | null, endIso: string | null): Promise<number> {
  // Exclude the onboarding test inquiry so it never inflates real lead metrics.
  let q = supabaseAdmin
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .eq('venue_id', venueId)
    .neq('source', 'test_inquiry');
  if (startIso) q = q.gte('created_at', startIso);
  if (endIso)   q = q.lte('created_at', endIso);
  const { count, error } = await q;
  if (error) console.error('[dashboard/stats] leads count', error);
  return count ?? 0;
}

async function countVenueCustomers(venueId: string, startIso: string | null, endIso: string | null): Promise<number> {
  let q = supabaseAdmin.from('venue_customers').select('*', { count: 'exact', head: true }).eq('venue_id', venueId);
  if (startIso) q = q.gte('created_at', startIso);
  if (endIso)   q = q.lte('created_at', endIso);
  const { count, error } = await q;
  if (error) console.error('[dashboard/stats] venue_customers count', error);
  return count ?? 0;
}

/** Tours and wedding/reception events in range — uses DB-side counts, excludes cancelled. */
async function countCalendarBookings(
  venueId: string,
  startAtGte: string | null,
  startAtLte: string | null,
): Promise<{ toursBooked: number; weddingsBooked: number }> {
  // Two parallel server-side count queries; no rows transferred over the wire.
  const base = () =>
    supabaseAdmin
      .from('calendar_events')
      .select('*', { count: 'exact', head: true })
      .eq('venue_id', venueId)
      .neq('status', 'cancelled');

  let toursQ    = base().eq('event_type', 'tour');
  let weddingsQ = base().in('event_type', ['wedding', 'reception']);
  if (startAtGte) { toursQ = toursQ.gte('start_at', startAtGte); weddingsQ = weddingsQ.gte('start_at', startAtGte); }
  if (startAtLte) { toursQ = toursQ.lte('start_at', startAtLte); weddingsQ = weddingsQ.lte('start_at', startAtLte); }

  const [{ count: toursCount }, { count: weddingsCount }] = await Promise.all([toursQ, weddingsQ]);
  return { toursBooked: toursCount ?? 0, weddingsBooked: weddingsCount ?? 0 };
}

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = request.nextUrl;
  const from = searchParams.get('from');
  const to   = searchParams.get('to');
  const currentCreatedEnd = to ? `${to}T23:59:59.999Z` : null;

  // Build both proposal queries upfront so they can run in parallel.
  const now       = new Date();
  const rangeStart = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const rangeEnd   = to   ? new Date(to)   : now;
  const periodMs   = rangeEnd.getTime() - rangeStart.getTime();
  const prevEnd    = new Date(rangeStart.getTime() - 1);
  const prevStart  = new Date(prevEnd.getTime() - periodMs);
  const prevStartStr = prevStart.toISOString();
  const prevEndStr   = prevEnd.toISOString();

  let proposalsQ = supabaseAdmin
    .from('proposals')
    .select('status, price, created_at, paid_at, customer_email')
    .eq('venue_id', venueId);
  if (from) proposalsQ = proposalsQ.gte('created_at', from);
  if (to)   proposalsQ = proposalsQ.lte('created_at', `${to}T23:59:59.999Z`);

  const prevProposalsQ = supabaseAdmin
    .from('proposals')
    .select('status, price, created_at')
    .eq('venue_id', venueId)
    .gte('created_at', prevStartStr)
    .lte('created_at', prevEndStr);

  // Fire everything in parallel — 8 independent DB queries → one round-trip.
  const [
    { data: allProposals },
    { data: prevProposals },
    leadCount,
    contactCount,
    { toursBooked, weddingsBooked },
    prevLeadCount,
    prevContactCount,
    prevCal,
  ] = await Promise.all([
    proposalsQ,
    prevProposalsQ,
    countLeads(venueId, from, currentCreatedEnd),
    countVenueCustomers(venueId, from, currentCreatedEnd),
    countCalendarBookings(venueId, from, currentCreatedEnd),
    countLeads(venueId, prevStartStr, prevEndStr),
    countVenueCustomers(venueId, prevStartStr, prevEndStr),
    countCalendarBookings(venueId, prevStartStr, prevEndStr),
  ]);

  const rows     = allProposals ?? [];
  const prevRows = prevProposals ?? [];

  // Revenue
  const totalRevenue = rows
    .filter((r) => r.status === 'paid')
    .reduce((sum, r) => sum + (r.price ?? 0), 0);

  // Status breakdown
  const statusBreakdown: Record<string, number> = {};
  for (const r of rows) {
    const s = r.status || 'unknown';
    statusBreakdown[s] = (statusBreakdown[s] || 0) + 1;
  }

  const activeProposals = rows.filter((r) => r.status !== 'draft').length;
  const pendingPayments = rows.filter((r) => r.status === 'sent' || r.status === 'opened').length;
  const failedPayments  = rows.filter((r) => r.status === 'failed' || r.status === 'declined').length;
  const refundedCount   = rows.filter((r) => r.status === 'refunded').length;
  const refundedAmount  = rows.filter((r) => r.status === 'refunded').reduce((s, r) => s + (r.price ?? 0), 0);
  const uniqueEmails    = new Set(rows.map((r) => r.customer_email).filter(Boolean));
  const customerCount   = uniqueEmails.size;

  // Monthly chart
  const monthlyData: Record<string, { revenue: number; proposals: number }> = {};
  const cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
  while (cursor <= rangeEnd) {
    const key = cursor.toISOString().slice(0, 7);
    monthlyData[key] = { revenue: 0, proposals: 0 };
    cursor.setMonth(cursor.getMonth() + 1);
  }
  const allKeys    = Object.keys(monthlyData).sort();
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
    label: new Date(month + '-15').toLocaleDateString('en-US', {
      month: 'short',
      year: cappedKeys.length > 6 ? '2-digit' : undefined,
    }),
    revenue:   data.revenue,
    proposals: data.proposals,
  }));

  // Trends
  const prevRevenue       = prevRows.filter((r) => r.status === 'paid').reduce((s, r) => s + (r.price ?? 0), 0);
  const prevProposalCount = prevRows.length;
  const proposalCount     = rows.length;

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
      revenueChange:  pctDelta(prevRevenue, totalRevenue),
      proposalChange: pctDelta(prevProposalCount, proposalCount),
      leadChange:     pctDelta(prevLeadCount, leadCount),
      contactChange:  pctDelta(prevContactCount, contactCount),
      toursChange:    pctDelta(prevCal.toursBooked, toursBooked),
      weddingsChange: pctDelta(prevCal.weddingsBooked, weddingsBooked),
      thisMonthRevenue:    totalRevenue,
      lastMonthRevenue:    prevRevenue,
      thisMonthProposals:  proposalCount,
      lastMonthProposals:  prevProposalCount,
    },
  });
}
