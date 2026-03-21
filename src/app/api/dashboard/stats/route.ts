import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET() {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;

  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [totalResult, statusCounts, revenueResult, customerResult] = await Promise.all([
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

  return NextResponse.json({
    totalRevenue,
    activeProposals,
    customerCount,
    pendingPayments,
  });
}
