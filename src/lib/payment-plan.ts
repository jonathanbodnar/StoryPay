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

// ── The payment builder's plan inputs (saved as payment_config.plan) ─────────

export type PlanKind = 'monthly' | 'deposit_final' | 'custom';
export type PlanEnd = 'event' | 'date' | 'count';

export interface PlanDraft {
  kind: PlanKind;
  depositMode: 'amount' | 'percent';
  /** Dollars (amount mode) or a percent of the total. */
  deposit: string;
  /** First monthly payment. */
  firstDate: string;
  /** How the plan ends: days before the wedding, on a date, or after a number of payments. */
  endMode: PlanEnd;
  endDate: string;
  count: string;
  eventDate: string;
  daysBefore: string;
  /** Custom schedule rows (dollars). Payment 1 is due at signing for online plans. */
  rows: Array<{ amount: string; date: string }>;
}

export function dollarsToCents(value: string | number | null | undefined): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? '').replace(/[,$\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function defaultPlanDraft(today: string, eventDate = ''): PlanDraft {
  return {
    kind: 'monthly',
    depositMode: 'percent',
    deposit: '25',
    firstDate: addMonthsYmd(today, 1),
    endMode: eventDate ? 'event' : 'count',
    endDate: '',
    count: '6',
    eventDate,
    daysBefore: '30',
    rows: [],
  };
}

/** A saved plan's inputs, or a custom plan built from its schedule. */
export function planDraftFromConfig(paymentConfig: unknown, today: string): PlanDraft {
  const saved = (paymentConfig as { plan?: Partial<PlanDraft> } | null)?.plan;
  const base = defaultPlanDraft(today);
  if (saved && typeof saved === 'object' && (saved.kind === 'monthly' || saved.kind === 'deposit_final' || saved.kind === 'custom')) {
    return { ...base, ...saved, rows: Array.isArray(saved.rows) ? saved.rows : [] };
  }
  const payments = planPayments(paymentConfig);
  if (!payments.length) return base;
  return {
    ...base,
    kind: 'custom',
    rows: payments.map((p) => ({ amount: Number.isFinite(p.amount) ? (p.amount / 100).toFixed(2) : '', date: toYmd(p.date) ?? '' })),
  };
}

/** The deposit in cents (the percent is of the total). */
export function planDepositCents(d: PlanDraft, totalCents: number): number {
  if (d.depositMode === 'percent') {
    const pct = parseFloat(d.deposit);
    return Number.isFinite(pct) && pct > 0 ? Math.round((totalCents * Math.min(pct, 100)) / 100) : 0;
  }
  return Math.max(0, dollarsToCents(d.deposit));
}

/** The plan's last date: days before the wedding, or the date the venue picked. */
export function planEndDate(d: PlanDraft): string | null {
  if (d.endMode === 'event') {
    const event = toYmd(d.eventDate);
    const days = parseInt(d.daysBefore, 10);
    return event ? addDaysYmd(event, -(Number.isFinite(days) && days > 0 ? days : 0)) : null;
  }
  return toYmd(d.endDate);
}

/**
 * The schedule for the builder's inputs, and what's wrong with it (if
 * anything) in words a venue owner can act on. Payment 1 is due today (at
 * signing) unless the venue collects by hand and dated it.
 */
export function planFromDraft(
  d: PlanDraft,
  totalCents: number,
  today: string,
  opts: { collectManually?: boolean } = {},
): { payments: PlanPayment[]; problem: string | null } {
  const none = (problem: string) => ({ payments: [] as PlanPayment[], problem });
  if (totalCents <= 0) return none('Add line items first. The plan is worked out from the total.');

  let payments: PlanPayment[];
  if (d.kind === 'custom') {
    payments = d.rows.map((r, i) => ({
      amount: dollarsToCents(r.amount),
      date: i === 0 && !opts.collectManually ? today : (toYmd(r.date) ?? ''),
    }));
  } else {
    const deposit = planDepositCents(d, totalCents);
    if (deposit > totalCents) return none('The deposit is more than the total.');
    if (deposit === totalCents) return none('The deposit covers the whole total. Choose Pay in full instead.');
    const end = planEndDate(d);
    if (d.kind === 'deposit_final') {
      if (deposit <= 0) return none('Enter the deposit due at signing.');
      if (!end) return none(d.endMode === 'event' ? 'Enter the wedding date.' : 'Pick the date of the final payment.');
      if (end <= today) return none('The final payment has to be after today.');
      payments = [{ amount: deposit, date: today }, { amount: totalCents - deposit, date: end }];
    } else {
      const first = toYmd(d.firstDate);
      if (!first) return none('Pick the date of the first monthly payment.');
      if (first <= today) return none('The first monthly payment has to be after today.');
      let count: number;
      if (d.endMode === 'count') {
        count = parseInt(d.count, 10);
        if (!Number.isFinite(count) || count < 1) return none('Enter how many monthly payments.');
      } else {
        if (!end) return none(d.endMode === 'event' ? 'Enter the wedding date.' : 'Pick the date of the last payment.');
        count = monthlyCountThrough(first, end);
        if (count < 1) return none('The last payment date is before the first monthly payment.');
      }
      if (count > MAX_PLAN_PAYMENTS - 1) return none(`A plan can have up to ${MAX_PLAN_PAYMENTS} payments.`);
      payments = buildMonthlyPlan({ totalCents, depositCents: deposit, firstDate: first, count, today });
    }
  }
  const problem = paymentTermsError({
    priceCents: totalCents,
    paymentType: 'installment',
    paymentConfig: { installments: payments },
    collectManually: opts.collectManually,
    today,
  });
  return { payments, problem };
}
