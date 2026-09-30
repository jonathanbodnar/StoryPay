/**
 * Payment plans on proposals and invoices: payment_config.installments is the
 * schedule, amounts in cents and dates as YYYY-MM-DD. Payment 1 is due when
 * the couple signs (or opens an invoice); later payments are charged
 * automatically on their dates (lib/stripe/proposal-payments.ts).
 *
 * Pure functions with no server imports, so the payment builder in the
 * browser and the API share the same math and the same rules.
 */

export type PlanPayment = { amount: number; date: string };

/** Stripe's smallest US charge. */
export const MIN_PAYMENT_CENTS = 50;
export const MAX_PLAN_PAYMENTS = 60;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date as YYYY-MM-DD, or null. */
export function toYmd(value: unknown): string | null {
  const s = typeof value === 'string' ? value.trim().slice(0, 10) : '';
  if (!YMD.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? s : null;
}

/** Today in the viewer's (or server's) local calendar. */
export function todayYmd(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * The same day of the month, `months` later. A day that doesn't exist in the
 * target month lands on its last day (Jan 31 → Feb 28 → Mar 31), like Stripe.
 */
export function addMonthsYmd(ymd: string, months: number, anchorDay?: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const day = anchorDay ?? d;
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, lastDay));
  return first.toISOString().slice(0, 10);
}

/** How many monthly dates from `start` fall on or before `end` (0 if end is before start). */
export function monthlyCountThrough(start: string, end: string): number {
  if (end < start) return 0;
  const anchor = Number(start.slice(8, 10));
  let n = 0;
  while (n < MAX_PLAN_PAYMENTS && addMonthsYmd(start, n, anchor) <= end) n++;
  return n;
}

/**
 * Split an amount into `count` payments. Regular payments are whole dollars
 * when that's possible; the last payment takes the difference, so the
 * payments always add up exactly.
 */
export function splitEvenly(totalCents: number, count: number): number[] {
  if (count <= 0 || totalCents <= 0) return [];
  if (count === 1) return [totalCents];
  let regular = Math.floor(totalCents / count / 100) * 100;
  if (regular < MIN_PAYMENT_CENTS) regular = Math.floor(totalCents / count);
  const last = totalCents - regular * (count - 1);
  return [...Array.from({ length: count - 1 }, () => regular), last];
}

/**
 * A deposit today, then monthly payments starting on `firstDate`.
 * With no deposit, the first of `count` equal payments is due today and the
 * rest follow monthly from `firstDate`.
 */
export function buildMonthlyPlan(opts: {
  totalCents: number;
  depositCents: number;
  firstDate: string;
  count: number;
  today: string;
}): PlanPayment[] {
  const { totalCents, today, firstDate } = opts;
  const deposit = Math.max(0, Math.min(Math.round(opts.depositCents), totalCents));
  const count = Math.max(0, Math.min(Math.round(opts.count), MAX_PLAN_PAYMENTS - 1));
  const anchor = Number(firstDate.slice(8, 10));
  if (deposit > 0) {
    const rest = splitEvenly(totalCents - deposit, count);
    return [{ amount: deposit, date: today }, ...rest.map((amount, i) => ({ amount, date: addMonthsYmd(firstDate, i, anchor) }))];
  }
  const parts = splitEvenly(totalCents, count + 1);
  return parts.map((amount, i) => ({ amount, date: i === 0 ? today : addMonthsYmd(firstDate, i - 1, anchor) }));
}

/** Read and clean payment_config.installments (amounts rounded to cents, dates as YYYY-MM-DD). */
export function planPayments(paymentConfig: unknown): PlanPayment[] {
  const list = (paymentConfig as { installments?: unknown } | null | undefined)?.installments;
  if (!Array.isArray(list)) return [];
  return list.map((raw) => {
    const r = (raw ?? {}) as { amount?: unknown; date?: unknown };
    const amount = typeof r.amount === 'number' ? r.amount : Number(r.amount);
    return { amount: Number.isFinite(amount) ? Math.round(amount) : NaN, date: toYmd(r.date) ?? String(r.date ?? '') };
  });
}

function usd(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

/**
 * Why these payment terms can't be sent to a couple, or null when they're
 * fine. Drafts skip this; it runs when a proposal or invoice is sent.
 */
export function paymentTermsError(t: {
  priceCents: number;
  paymentType: string | null | undefined;
  paymentConfig: unknown;
  collectManually?: boolean;
  today?: string;
}): string | null {
  const type = t.paymentType || 'full';
  const cfg = (t.paymentConfig ?? {}) as { due_date?: unknown };

  if (type === 'subscription') {
    return 'Recurring subscriptions aren’t available. Choose Pay in full or a payment plan.';
  }
  if (type !== 'full' && type !== 'installment') return 'Choose Pay in full or a payment plan.';

  if (cfg.due_date !== undefined && cfg.due_date !== null && cfg.due_date !== '' && !toYmd(cfg.due_date)) {
    return 'The due date isn’t a valid date.';
  }
  if (type === 'full') return null;

  const payments = planPayments(t.paymentConfig);
  if (payments.length < 2) return 'A payment plan needs at least 2 payments.';
  if (payments.length > MAX_PLAN_PAYMENTS) return `A payment plan can have up to ${MAX_PLAN_PAYMENTS} payments.`;

  // A day of slack so a venue in an earlier time zone isn't told "today" is in the past.
  const earliest = addDaysYmd(t.today ?? todayYmd(), -1);
  for (let i = 0; i < payments.length; i++) {
    const p = payments[i];
    const label = `Payment ${i + 1}`;
    if (!Number.isInteger(p.amount) || p.amount <= 0) return `${label} needs an amount.`;
    if (p.amount < MIN_PAYMENT_CENTS) return `${label} must be at least ${usd(MIN_PAYMENT_CENTS)}.`;
    if (!toYmd(p.date)) return `${label} needs a date.`;
    if (i > 0 && p.date < payments[i - 1].date) return `${label} is dated before payment ${i}. Put the payments in date order.`;
    if (i > 0 && p.date < earliest) return `${label} is dated in the past.`;
  }

  const sum = payments.reduce((s, p) => s + p.amount, 0);
  if (sum !== Math.round(t.priceCents)) {
    return `The payments add up to ${usd(sum)}, but the total is ${usd(Math.round(t.priceCents))}. Adjust the payments so they match.`;
  }
  return null;
}

/**
 * The money-relevant part of a proposal's terms, for spotting a change.
 * Display-only details (like the builder's saved inputs) are left out.
 */
export function termsFingerprint(priceCents: unknown, paymentType: unknown, paymentConfig: unknown): string {
  const cfg = (paymentConfig ?? {}) as { due_date?: unknown; amount?: unknown; frequency?: unknown; start_date?: unknown };
  return JSON.stringify({
    price: Math.round(Number(priceCents) || 0),
    type: (typeof paymentType === 'string' && paymentType) || 'full',
    payments: planPayments(paymentConfig),
    due: toYmd(cfg.due_date),
    sub: [cfg.amount ?? null, cfg.frequency ?? null, toYmd(cfg.start_date)],
  });
}
