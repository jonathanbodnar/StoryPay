import { NextRequest, NextResponse } from 'next/server';
import { getVenueId } from '@/lib/auth-helpers';
import { supabaseAdmin } from '@/lib/supabase';
import { neutralizeFormula } from '@/lib/csv';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function csvEscape(s: string): string {
  const t = neutralizeFormula(s ?? '');
  if (/[",\n\r]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

// Plain decimal dollars (parseable by Excel / QuickBooks / FreshBooks).
// e.g. 1234.56  or  -1234.56
function formatAmountDecimal(cents: number): string {
  const dollars = cents / 100;
  const sign = dollars < 0 ? '-' : '';
  return `${sign}${Math.abs(dollars).toFixed(2)}`;
}

// Human-readable dollars and cents with thousands separators.
// e.g. $1,234.56  or  -$1,234.56
function formatAmountCurrency(cents: number): string {
  const dollars = cents / 100;
  const sign = dollars < 0 ? '-' : '';
  const abs = Math.abs(dollars).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}$${abs}`;
}

export async function GET(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = request.nextUrl;
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  const fromD = from ? new Date(`${from}T00:00:00.000Z`) : null;
  const toD = to ? new Date(`${to}T23:59:59.999Z`) : null;
  const inRange = (raw: string | null | undefined) => {
    if (!raw) return false;
    const t = new Date(raw);
    return !(fromD && t < fromD) && !(toD && t > toD);
  };

  // Every payment from the payment ledger, on the day it was paid (each
  // payment of a plan, and cash and check), and every refund on the day it
  // was refunded, for its actual amount. Read in pages: a request returns at
  // most 1,000 rows.
  type LedgerRow = {
    id: string; proposal_id: string; payment_number: number | null; amount_cents: number; refunded_cents: number | null;
    refunded_at: string | null; method: string; check_number: string | null; paid_at: string;
  };
  const ledger: LedgerRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data: page, error } = await supabaseAdmin
      .from('proposal_payments')
      .select('id, proposal_id, payment_number, amount_cents, refunded_cents, refunded_at, method, check_number, paid_at')
      .eq('venue_id', venueId)
      .order('paid_at', { ascending: true })
      .range(offset, offset + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    ledger.push(...((page ?? []) as LedgerRow[]));
    if (!page || page.length < 1000) break;
  }

  // The bookings behind those payments, plus older paid or refunded ones
  // recorded before the ledger existed (they keep their whole-price lines).
  type Booking = {
    id: string; status: string; price: number | null; paid_at: string | null; updated_at: string | null; refunded_at: string | null;
    customer_name: string | null; customer_email: string | null; payment_type: string | null; public_token: string | null;
  };
  const cols = 'id, status, price, paid_at, updated_at, refunded_at, customer_name, customer_email, payment_type, public_token';
  const byId = new Map<string, Booking>();
  const ids = [...new Set(ledger.map((r) => r.proposal_id))];
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await supabaseAdmin.from('proposals').select(cols).in('id', ids.slice(i, i + 100));
    for (const b of (data ?? []) as Booking[]) byId.set(b.id, b);
  }
  const { data: older } = await supabaseAdmin.from('proposals').select(cols).eq('venue_id', venueId).in('status', ['paid', 'refunded']);
  for (const b of (older ?? []) as Booking[]) if (!byId.has(b.id)) byId.set(b.id, b);
  const inLedger = new Set(ledger.map((r) => r.proposal_id));
  const methodName = (m: string, check: string | null) =>
    m === 'cc' ? 'card' : m === 'ach' ? 'bank' : m === 'check' ? (check ? `check #${check}` : 'check') : m === 'cash' ? 'cash' : 'other';

  type Entry = { date: string; type: 'payment' | 'refund'; cents: number; booking: Booking | undefined; proposalId: string; method: string; number: string };
  const entries: Entry[] = [];
  for (const r of ledger) {
    const booking = byId.get(r.proposal_id);
    const method = methodName(r.method, r.check_number);
    const number = r.payment_number != null ? String(r.payment_number) : '';
    if (inRange(r.paid_at)) entries.push({ date: r.paid_at, type: 'payment', cents: r.amount_cents, booking, proposalId: r.proposal_id, method, number });
    const refunded = Number(r.refunded_cents) || 0;
    if (refunded > 0 && inRange(r.refunded_at)) {
      entries.push({ date: r.refunded_at as string, type: 'refund', cents: -refunded, booking, proposalId: r.proposal_id, method, number });
    }
  }
  for (const p of byId.values()) {
    if (inLedger.has(p.id)) continue;
    const gross = Number(p.price ?? 0) || 0;
    if (p.status === 'paid' && inRange(p.paid_at)) {
      entries.push({ date: p.paid_at as string, type: 'payment', cents: gross, booking: p, proposalId: p.id, method: '', number: '' });
    } else if (p.status === 'refunded') {
      const raw = p.refunded_at || p.updated_at || p.paid_at;
      if (inRange(raw)) entries.push({ date: raw as string, type: 'refund', cents: -gross, booking: p, proposalId: p.id, method: '', number: '' });
    }
  }
  entries.sort((a, b) => a.date.localeCompare(b.date));

  const header = [
    'posting_date',
    'entry_type',
    'amount',
    'amount_formatted',
    'amount_cents',
    'currency',
    'customer_name',
    'customer_email',
    'payment_type',
    'proposal_status',
    'proposal_id',
    'public_token',
    'payment_method',
    'payment_number',
  ];

  const lines: string[] = [header.join(',')];

  for (const e of entries) {
    const b = e.booking;
    lines.push(
      [
        csvEscape(new Date(e.date).toISOString().slice(0, 10)),
        e.type,
        formatAmountDecimal(e.cents),
        csvEscape(formatAmountCurrency(e.cents)),
        String(e.cents),
        'USD',
        csvEscape(String(b?.customer_name ?? '')),
        csvEscape(String(b?.customer_email ?? '')),
        csvEscape(String(b?.payment_type ?? '')),
        csvEscape(String(b?.status ?? '')),
        csvEscape(e.proposalId),
        csvEscape(String(b?.public_token ?? '')),
        csvEscape(e.method),
        csvEscape(e.number),
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
