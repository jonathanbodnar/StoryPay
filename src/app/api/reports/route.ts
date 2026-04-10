import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// Report types:
// revenue         - all paid proposals with breakdown
// proposals       - all proposals with status, amount, payment type
// customers       - unique customers with total spend
// aging           - unpaid proposals grouped by how long they've been open
// payment-methods - breakdown by payment type (full/installment/subscription)
// refunds         - refunded proposals

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = request.nextUrl;
  const type = searchParams.get('type') || 'revenue';
  const from = searchParams.get('from');
  const to   = searchParams.get('to');

  const toEnd = to ? to + 'T23:59:59.999Z' : undefined;

  switch (type) {

    case 'revenue': {
      let q = supabaseAdmin
        .from('proposals')
        .select('id, customer_name, customer_email, price, payment_type, paid_at, created_at, public_token')
        .eq('venue_id', venueId)
        .eq('status', 'paid')
        .order('paid_at', { ascending: false });
      if (from)   q = q.gte('paid_at', from);
      if (toEnd)  q = q.lte('paid_at', toEnd);
      const { data } = await q;
      const rows = (data ?? []).map((r) => ({
        'Date Paid':      r.paid_at ? new Date(r.paid_at).toLocaleDateString('en-US') : '',
        'Customer Name':  r.customer_name ?? '',
        'Customer Email': r.customer_email ?? '',
        'Amount ($)':     ((r.price ?? 0) / 100).toFixed(2),
        'Payment Type':   r.payment_type ?? '',
        'Proposal ID':    r.id,
      }));
      const total = (data ?? []).reduce((s, r) => s + (r.price ?? 0), 0);
      return NextResponse.json({ rows, summary: { 'Total Revenue': `$${(total / 100).toFixed(2)}`, 'Transactions': rows.length } });
    }

    case 'proposals': {
      let q = supabaseAdmin
        .from('proposals')
        .select('id, customer_name, customer_email, status, price, payment_type, sent_at, created_at, paid_at')
        .eq('venue_id', venueId)
        .order('created_at', { ascending: false });
      if (from)  q = q.gte('created_at', from);
      if (toEnd) q = q.lte('created_at', toEnd);
      const { data } = await q;
      const rows = (data ?? []).map((r) => ({
        'Created':        new Date(r.created_at).toLocaleDateString('en-US'),
        'Customer Name':  r.customer_name ?? '',
        'Customer Email': r.customer_email ?? '',
        'Status':         r.status ?? '',
        'Amount ($)':     ((r.price ?? 0) / 100).toFixed(2),
        'Payment Type':   r.payment_type ?? '',
        'Sent Date':      r.sent_at ? new Date(r.sent_at).toLocaleDateString('en-US') : '',
        'Paid Date':      r.paid_at ? new Date(r.paid_at).toLocaleDateString('en-US') : '',
        'Proposal ID':    r.id,
      }));
      const statusCounts: Record<string, number> = {};
      for (const r of data ?? []) statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
      return NextResponse.json({ rows, summary: { 'Total Proposals': rows.length, ...statusCounts } });
    }

    case 'customers': {
      let q = supabaseAdmin
        .from('proposals')
        .select('customer_name, customer_email, customer_phone, price, status, created_at')
        .eq('venue_id', venueId);
      if (from)  q = q.gte('created_at', from);
      if (toEnd) q = q.lte('created_at', toEnd);
      const { data } = await q;

      const map: Record<string, { name: string; email: string; phone: string; totalSpend: number; proposalCount: number; paidCount: number; lastActivity: string }> = {};
      for (const r of data ?? []) {
        const key = (r.customer_email || r.customer_name || 'unknown').toLowerCase();
        if (!map[key]) map[key] = { name: r.customer_name ?? '', email: r.customer_email ?? '', phone: r.customer_phone ?? '', totalSpend: 0, proposalCount: 0, paidCount: 0, lastActivity: r.created_at };
        map[key].proposalCount++;
        if (r.status === 'paid') { map[key].totalSpend += r.price ?? 0; map[key].paidCount++; }
        if (r.created_at > map[key].lastActivity) map[key].lastActivity = r.created_at;
      }

      const rows = Object.values(map)
        .sort((a, b) => b.totalSpend - a.totalSpend)
        .map((c) => ({
          'Customer Name':    c.name,
          'Email':            c.email,
          'Phone':            c.phone,
          'Total Spend ($)':  (c.totalSpend / 100).toFixed(2),
          'Proposals':        c.proposalCount,
          'Paid Proposals':   c.paidCount,
          'Last Activity':    new Date(c.lastActivity).toLocaleDateString('en-US'),
        }));
      return NextResponse.json({ rows, summary: { 'Unique Customers': rows.length, 'Total Revenue': `$${(Object.values(map).reduce((s,c) => s+c.totalSpend,0)/100).toFixed(2)}` } });
    }

    case 'aging': {
      let q = supabaseAdmin
        .from('proposals')
        .select('id, customer_name, customer_email, price, status, sent_at, created_at')
        .eq('venue_id', venueId)
        .in('status', ['sent', 'opened', 'signed']);
      if (from)  q = q.gte('created_at', from);
      if (toEnd) q = q.lte('created_at', toEnd);
      const { data } = await q;
      const now = Date.now();
      const rows = (data ?? [])
        .map((r) => {
          const sentDate = r.sent_at ? new Date(r.sent_at) : new Date(r.created_at);
          const days = Math.floor((now - sentDate.getTime()) / 86400000);
          const bucket = days <= 7 ? '0–7 days' : days <= 14 ? '8–14 days' : days <= 30 ? '15–30 days' : days <= 60 ? '31–60 days' : '60+ days';
          return {
            'Customer Name':  r.customer_name ?? '',
            'Customer Email': r.customer_email ?? '',
            'Status':         r.status ?? '',
            'Amount ($)':     ((r.price ?? 0) / 100).toFixed(2),
            'Days Outstanding': days,
            'Age Bucket':     bucket,
            'Sent Date':      sentDate.toLocaleDateString('en-US'),
            'Proposal ID':    r.id,
          };
        })
        .sort((a, b) => b['Days Outstanding'] - a['Days Outstanding']);
      const totalOutstanding = (data ?? []).reduce((s, r) => s + (r.price ?? 0), 0);
      return NextResponse.json({ rows, summary: { 'Outstanding Proposals': rows.length, 'Total Outstanding': `$${(totalOutstanding / 100).toFixed(2)}` } });
    }

    case 'payment-methods': {
      let q = supabaseAdmin
        .from('proposals')
        .select('payment_type, price, status, created_at')
        .eq('venue_id', venueId);
      if (from)  q = q.gte('created_at', from);
      if (toEnd) q = q.lte('created_at', toEnd);
      const { data } = await q;

      const map: Record<string, { count: number; paidCount: number; revenue: number }> = {};
      for (const r of data ?? []) {
        const pt = r.payment_type || 'unknown';
        if (!map[pt]) map[pt] = { count: 0, paidCount: 0, revenue: 0 };
        map[pt].count++;
        if (r.status === 'paid') { map[pt].paidCount++; map[pt].revenue += r.price ?? 0; }
      }
      const rows = Object.entries(map).map(([type, d]) => ({
        'Payment Type':      type,
        'Total Proposals':   d.count,
        'Paid Proposals':    d.paidCount,
        'Conversion Rate':   d.count > 0 ? `${Math.round((d.paidCount / d.count) * 100)}%` : '0%',
        'Revenue ($)':       (d.revenue / 100).toFixed(2),
      }));
      return NextResponse.json({ rows, summary: {} });
    }

    case 'refunds': {
      let q = supabaseAdmin
        .from('proposals')
        .select('id, customer_name, customer_email, price, payment_type, paid_at, created_at')
        .eq('venue_id', venueId)
        .eq('status', 'refunded')
        .order('paid_at', { ascending: false });
      if (from)  q = q.gte('created_at', from);
      if (toEnd) q = q.lte('created_at', toEnd);
      const { data } = await q;
      const rows = (data ?? []).map((r) => ({
        'Customer Name':  r.customer_name ?? '',
        'Customer Email': r.customer_email ?? '',
        'Amount ($)':     ((r.price ?? 0) / 100).toFixed(2),
        'Payment Type':   r.payment_type ?? '',
        'Original Date':  r.paid_at ? new Date(r.paid_at).toLocaleDateString('en-US') : '',
        'Proposal ID':    r.id,
      }));
      const total = (data ?? []).reduce((s, r) => s + (r.price ?? 0), 0);
      return NextResponse.json({ rows, summary: { 'Total Refunds': rows.length, 'Total Refunded': `$${(total / 100).toFixed(2)}` } });
    }

    case 'bank-reconciliation': {
      // Fetch all paid proposals in range
      let qPaid = supabaseAdmin
        .from('proposals')
        .select('id, customer_name, customer_email, price, payment_type, paid_at, created_at, payment_config')
        .eq('venue_id', venueId)
        .eq('status', 'paid')
        .order('paid_at', { ascending: false });
      if (from)  qPaid = qPaid.gte('paid_at', from);
      if (toEnd) qPaid = qPaid.lte('paid_at', toEnd);

      // Fetch refunds in same range
      let qRef = supabaseAdmin
        .from('proposals')
        .select('id, customer_name, price, paid_at')
        .eq('venue_id', venueId)
        .eq('status', 'refunded')
        .order('paid_at', { ascending: false });
      if (from)  qRef = qRef.gte('paid_at', from);
      if (toEnd) qRef = qRef.lte('paid_at', toEnd);

      // Get venue fee rate
      const { data: venue } = await supabaseAdmin
        .from('venues')
        .select('service_fee_rate')
        .eq('id', venueId)
        .single();

      const feeRate = (venue?.service_fee_rate ?? 2.75) / 100;

      const [{ data: paid }, { data: refunded }] = await Promise.all([qPaid, qRef]);

      const paidRows = (paid ?? []).map((r) => {
        const gross = (r.price ?? 0) / 100;
        const processingFee = parseFloat((gross * feeRate).toFixed(2));
        const net = parseFloat((gross - processingFee).toFixed(2));
        return {
          'Date':             r.paid_at ? new Date(r.paid_at).toLocaleDateString('en-US') : '',
          'Type':             'Payment Received',
          'Customer':         r.customer_name ?? '',
          'Description':      `${(r.payment_type ?? 'full').replace('_', ' ')} payment`,
          'Gross Amount ($)': gross.toFixed(2),
          'Processing Fee ($)': processingFee.toFixed(2),
          'Net to Bank ($)':  net.toFixed(2),
          'Proposal ID':      r.id,
        };
      });

      const refundRows = (refunded ?? []).map((r) => {
        const gross = (r.price ?? 0) / 100;
        return {
          'Date':               r.paid_at ? new Date(r.paid_at).toLocaleDateString('en-US') : '',
          'Type':               'Refund Issued',
          'Customer':           r.customer_name ?? '',
          'Description':        'Refund',
          'Gross Amount ($)':   `(${gross.toFixed(2)})`,
          'Processing Fee ($)': '—',
          'Net to Bank ($)':    `(${gross.toFixed(2)})`,
          'Proposal ID':        r.id,
        };
      });

      const rows = [...paidRows, ...refundRows].sort((a, b) =>
        new Date(b['Date']).getTime() - new Date(a['Date']).getTime()
      );

      const totalGross  = (paid ?? []).reduce((s, r) => s + (r.price ?? 0), 0) / 100;
      const totalFees   = parseFloat((totalGross * feeRate).toFixed(2));
      const totalNet    = parseFloat((totalGross - totalFees).toFixed(2));
      const totalRefunds = (refunded ?? []).reduce((s, r) => s + (r.price ?? 0), 0) / 100;
      const netDeposit  = parseFloat((totalNet - totalRefunds).toFixed(2));

      return NextResponse.json({
        rows,
        summary: {
          'Total Payments':        paidRows.length,
          'Gross Collections ($)': totalGross.toFixed(2),
          'Processing Fees ($)':   totalFees.toFixed(2),
          'Total Refunds ($)':     totalRefunds.toFixed(2),
          'Estimated Net Deposit ($)': netDeposit.toFixed(2),
        },
      });
    }

    default:
      return NextResponse.json({ error: 'Invalid report type' }, { status: 400 });
  }
}
