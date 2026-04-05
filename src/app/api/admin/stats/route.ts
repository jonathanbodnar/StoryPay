import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

async function verifyAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  return token && token === process.env.ADMIN_SECRET;
}

export async function GET(request: NextRequest) {
  if (!(await verifyAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const from = searchParams.get('from');
  const to   = searchParams.get('to');
  const toEnd = to ? to + 'T23:59:59.999Z' : undefined;

  // All proposals in range
  let q = supabaseAdmin.from('proposals').select('status, price, created_at, paid_at, customer_email, venue_id');
  if (from)   q = q.gte('created_at', from);
  if (toEnd)  q = q.lte('created_at', toEnd);
  const { data: proposals } = await q;
  const rows = proposals ?? [];

  const totalRevenue = rows.filter(r => r.status === 'paid').reduce((s, r) => s + (r.price ?? 0), 0);
  const totalProposals = rows.length;
  const pendingPayments = rows.filter(r => r.status === 'sent' || r.status === 'opened').length;
  const failedPayments  = rows.filter(r => r.status === 'failed' || r.status === 'declined').length;
  const uniqueCustomers = new Set(rows.map(r => r.customer_email).filter(Boolean)).size;
  const uniqueVenues    = new Set(rows.map(r => r.venue_id).filter(Boolean)).size;

  const statusBreakdown: Record<string, number> = {};
  for (const r of rows) {
    const s = r.status || 'unknown';
    statusBreakdown[s] = (statusBreakdown[s] || 0) + 1;
  }

  // Waitlist count
  const { count: waitlistCount } = await supabaseAdmin.from('waitlist').select('*', { count: 'exact', head: true });

  // Venue count
  const { count: venueCount } = await supabaseAdmin.from('venues').select('*', { count: 'exact', head: true });

  // Monthly chart
  const now = new Date();
  const rangeStart = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const rangeEnd   = to   ? new Date(to)   : now;
  const monthlyData: Record<string, { revenue: number; proposals: number }> = {};
  const cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
  while (cursor <= rangeEnd) {
    const key = cursor.toISOString().slice(0, 7);
    monthlyData[key] = { revenue: 0, proposals: 0 };
    cursor.setMonth(cursor.getMonth() + 1);
  }
  for (const p of rows) {
    const month = (p.paid_at || p.created_at)?.slice(0, 7);
    if (month && monthlyData[month]) {
      monthlyData[month].proposals++;
      if (p.status === 'paid') monthlyData[month].revenue += p.price || 0;
    }
  }
  const monthlyChart = Object.entries(monthlyData).map(([month, d]) => ({
    month,
    label: new Date(month + '-15').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
    revenue: d.revenue,
    proposals: d.proposals,
  }));

  // Top feature requests
  const { data: featureRequests } = await supabaseAdmin
    .from('feature_requests')
    .select('id, title, description, vote_count, status, created_at')
    .order('vote_count', { ascending: false })
    .limit(10);

  return NextResponse.json({
    totalRevenue,
    totalProposals,
    pendingPayments,
    failedPayments,
    uniqueCustomers,
    uniqueVenues,
    waitlistCount: waitlistCount ?? 0,
    venueCount: venueCount ?? 0,
    statusBreakdown,
    monthlyChart,
    featureRequests: featureRequests ?? [],
  });
}
