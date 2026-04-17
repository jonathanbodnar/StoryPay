import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

/** YYYY-MM from ISO timestamptz (UTC month). */
function utcMonthKey(iso: string): string {
  return iso.slice(0, 7);
}

function shiftYearMonth(key: string, deltaYears: number): string {
  const [y, m] = key.split('-').map(Number);
  return `${y + deltaYears}-${pad2(m)}`;
}

function monthLabel(key: string, shortYear: boolean) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  const mon = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  return shortYear ? `${mon} ’${String(y).slice(-2)}` : `${mon} ${y}`;
}

function pctChange(prev: number, curr: number): number | null {
  if (prev === 0 && curr === 0) return null;
  if (prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

export async function GET() {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const curY = now.getUTCFullYear();
  const curM = now.getUTCMonth(); // 0..11

  // Rolling 12 months ending current UTC month (oldest → newest).
  const monthKeys: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(curY, curM - i, 1));
    monthKeys.push(`${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`);
  }

  const oldestKey = monthKeys[0]!;
  const [oy, om] = oldestKey.split('-').map(Number);
  const rangeStart = new Date(Date.UTC(oy, om - 1 - 12, 1)); // 12 extra months for YoY baseline
  const rangeEnd = new Date(Date.UTC(curY, curM + 1, 0, 23, 59, 59, 999));
  const isoStart = rangeStart.toISOString();
  const isoEnd = rangeEnd.toISOString();

  const weddingsByMonth: Record<string, number> = {};

  const { data: events, error: evErr } = await supabaseAdmin
    .from('calendar_events')
    .select('start_at, event_type, status')
    .eq('venue_id', venueId)
    .in('event_type', ['wedding', 'reception'])
    .gte('start_at', isoStart)
    .lte('start_at', isoEnd);

  if (evErr) {
    console.error('[booking-trends] calendar_events', evErr);
  } else {
    for (const row of events ?? []) {
      if (row.status === 'cancelled') continue;
      const k = utcMonthKey(row.start_at as string);
      weddingsByMonth[k] = (weddingsByMonth[k] ?? 0) + 1;
    }
  }

  const incomeByMonth: Record<string, number> = {};

  const paidSelect = 'price, paid_at, created_at';
  const [{ data: paidWithPaidAt, error: e1 }, { data: paidNoPaidAt, error: e2 }] = await Promise.all([
    supabaseAdmin
      .from('proposals')
      .select(paidSelect)
      .eq('venue_id', venueId)
      .eq('status', 'paid')
      .not('paid_at', 'is', null)
      .gte('paid_at', isoStart)
      .lte('paid_at', isoEnd),
    supabaseAdmin
      .from('proposals')
      .select(paidSelect)
      .eq('venue_id', venueId)
      .eq('status', 'paid')
      .is('paid_at', null)
      .gte('created_at', isoStart)
      .lte('created_at', isoEnd),
  ]);

  if (e1 || e2) {
    console.error('[booking-trends] proposals', e1 ?? e2);
  }
  for (const row of [...(paidWithPaidAt ?? []), ...(paidNoPaidAt ?? [])]) {
    const raw = (row.paid_at as string | null) ?? (row.created_at as string);
    if (!raw) continue;
    const k = utcMonthKey(raw);
    incomeByMonth[k] = (incomeByMonth[k] ?? 0) + (row.price ?? 0);
  }

  const shortYearLabels = monthKeys.length > 8;
  const series = monthKeys.map((key, idx) => {
    const prevYearKey = shiftYearMonth(key, -1);
    const w = weddingsByMonth[key] ?? 0;
    const wPy = weddingsByMonth[prevYearKey] ?? 0;
    const inc = incomeByMonth[key] ?? 0;
    const incPy = incomeByMonth[prevYearKey] ?? 0;

    const prevMonthKey = idx > 0 ? monthKeys[idx - 1]! : null;
    const wPm = prevMonthKey != null ? weddingsByMonth[prevMonthKey] ?? 0 : 0;
    const incPm = prevMonthKey != null ? incomeByMonth[prevMonthKey] ?? 0 : 0;

    return {
      month: key,
      label: monthLabel(key, shortYearLabels),
      weddingsBooked: w,
      incomeCents: inc,
      weddingsPrevYear: wPy,
      incomePrevYearCents: incPy,
      weddingsMomPct: prevMonthKey != null ? pctChange(wPm, w) : null,
      incomeMomPct: prevMonthKey != null ? pctChange(incPm, inc) : null,
      weddingsYoyPct: pctChange(wPy, w),
      incomeYoyPct: pctChange(incPy, inc),
    };
  });

  const last = series[series.length - 1]!;
  const prev = series.length >= 2 ? series[series.length - 2]! : null;

  // YTD: Jan → current month, this UTC year vs same window prior year
  let ytdWeddings = 0;
  let ytdIncome = 0;
  let ytdWeddingsPrev = 0;
  let ytdIncomePrev = 0;
  for (let mm = 1; mm <= curM + 1; mm++) {
    const kThis = `${curY}-${pad2(mm)}`;
    ytdWeddings += weddingsByMonth[kThis] ?? 0;
    ytdIncome += incomeByMonth[kThis] ?? 0;
    const kPrev = `${curY - 1}-${pad2(mm)}`;
    ytdWeddingsPrev += weddingsByMonth[kPrev] ?? 0;
    ytdIncomePrev += incomeByMonth[kPrev] ?? 0;
  }

  return NextResponse.json({
    series,
    thisMonth: {
      month: last.month,
      label: last.label,
      weddingsBooked: last.weddingsBooked,
      incomeCents: last.incomeCents,
      weddingsMomPct: last.weddingsMomPct,
      incomeMomPct: last.incomeMomPct,
      weddingsYoyPct: last.weddingsYoyPct,
      incomeYoyPct: last.incomeYoyPct,
    },
    lastMonth: prev
      ? {
          month: prev.month,
          label: prev.label,
          weddingsBooked: prev.weddingsBooked,
          incomeCents: prev.incomeCents,
        }
      : null,
    ytd: {
      year: curY,
      weddingsBooked: ytdWeddings,
      incomeCents: ytdIncome,
      weddingsPrevYear: ytdWeddingsPrev,
      incomePrevYearCents: ytdIncomePrev,
      weddingsYoyPct: pctChange(ytdWeddingsPrev, ytdWeddings),
      incomeYoyPct: pctChange(ytdIncomePrev, ytdIncome),
    },
  });
}
