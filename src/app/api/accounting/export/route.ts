import { NextRequest, NextResponse } from 'next/server';
import { getVenueId } from '@/lib/auth-helpers';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function csvEscape(s: string): string {
  const t = s ?? '';
  if (/[",\n\r]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

export async function GET(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = request.nextUrl;
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  const { data: rows, error } = await supabaseAdmin
    .from('proposals')
    .select(
      'id, status, price, paid_at, updated_at, customer_name, customer_email, payment_type, public_token',
    )
    .eq('venue_id', venueId)
    .in('status', ['paid', 'refunded'])
    .order('paid_at', { ascending: true, nullsFirst: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const fromD = from ? new Date(`${from}T00:00:00.000Z`) : null;
  const toD = to ? new Date(`${to}T23:59:59.999Z`) : null;

  const filtered = (rows ?? []).filter((r) => {
    const status = r.status as string;
    if (status === 'paid') {
      if (!r.paid_at) return false;
      const t = new Date(r.paid_at as string);
      if (fromD && t < fromD) return false;
      if (toD && t > toD) return false;
      return true;
    }
    if (status === 'refunded') {
      const raw = (r.updated_at as string) || (r.paid_at as string);
      if (!raw) return false;
      const t = new Date(raw);
      if (fromD && t < fromD) return false;
      if (toD && t > toD) return false;
      return true;
    }
    return false;
  });

  const header = [
    'posting_date',
    'entry_type',
    'amount_cents',
    'currency',
    'customer_name',
    'customer_email',
    'payment_type',
    'proposal_status',
    'proposal_id',
    'public_token',
  ];

  const lines: string[] = [header.join(',')];

  for (const r of filtered) {
    const isRefund = r.status === 'refunded';
    const postingRaw = isRefund ? ((r.updated_at as string) || (r.paid_at as string)) : (r.paid_at as string);
    const postingDate = postingRaw ? new Date(postingRaw).toISOString().slice(0, 10) : '';
    const gross = Number(r.price ?? 0) || 0;
    const amount = isRefund ? -gross : gross;
    lines.push(
      [
        csvEscape(postingDate),
        isRefund ? 'refund' : 'payment',
        String(amount),
        'USD',
        csvEscape(String(r.customer_name ?? '')),
        csvEscape(String(r.customer_email ?? '')),
        csvEscape(String(r.payment_type ?? '')),
        csvEscape(String(r.status ?? '')),
        csvEscape(String(r.id)),
        csvEscape(String(r.public_token ?? '')),
      ].join(','),
    );
  }

  const csv = lines.join('\n');
  const fname = `storypay-accounting-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fname}"`,
    },
  });
}
