import { describe, expect, it } from 'vitest';
import {
  addDaysYmd,
  addMonthsYmd,
  buildMonthlyPlan,
  defaultPlanDraft,
  dollarsToCents,
  MAX_PLAN_PAYMENTS,
  monthlyCountThrough,
  paymentTermsError,
  planDepositCents,
  planEndDate,
  planFromDraft,
  planPayments,
  splitEvenly,
  termsFingerprint,
  toYmd,
  type PlanDraft,
} from '@/lib/payment-plan';

const TODAY = '2026-10-01';
const sum = (xs: Array<{ amount: number }>) => xs.reduce((s, p) => s + p.amount, 0);

describe('dates', () => {
  it('accepts only real calendar dates', () => {
    expect(toYmd('2026-02-28')).toBe('2026-02-28');
    expect(toYmd('2028-02-29')).toBe('2028-02-29');
    expect(toYmd('2026-02-29')).toBeNull();
    expect(toYmd('2026-13-01')).toBeNull();
    expect(toYmd('2026-10-01T15:30:00Z')).toBe('2026-10-01');
    expect(toYmd(' 2026-10-01 ')).toBe('2026-10-01');
    for (const bad of ['', 'October 1', null, undefined, 20261001, {}]) expect(toYmd(bad)).toBeNull();
  });

  it('adds days across month and year ends', () => {
    expect(addDaysYmd('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysYmd('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDaysYmd('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('keeps the day of the month, landing on the last day when it is missing', () => {
    expect(addMonthsYmd('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsYmd('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonthsYmd('2026-01-31', 2, 31)).toBe('2026-03-31');
    expect(addMonthsYmd('2026-11-15', 2)).toBe('2027-01-15');
  });

  it('counts monthly dates through an end date', () => {
    expect(monthlyCountThrough('2026-01-15', '2026-06-15')).toBe(6);
    expect(monthlyCountThrough('2026-01-15', '2026-06-14')).toBe(5);
    expect(monthlyCountThrough('2026-01-15', '2026-01-15')).toBe(1);
    expect(monthlyCountThrough('2026-01-15', '2026-01-14')).toBe(0);
    expect(monthlyCountThrough('2026-01-01', '2099-01-01')).toBe(MAX_PLAN_PAYMENTS);
  });
});

describe('splitEvenly', () => {
  it('uses whole dollars and puts the difference on the last payment', () => {
    expect(splitEvenly(100000, 3)).toEqual([33300, 33300, 33400]);
    expect(splitEvenly(450000, 3)).toEqual([150000, 150000, 150000]);
  });

  it('falls back to cents for small amounts', () => {
    expect(splitEvenly(100, 3)).toEqual([33, 33, 34]);
  });

  it('handles one payment and nothing to split', () => {
    expect(splitEvenly(12345, 1)).toEqual([12345]);
    expect(splitEvenly(0, 3)).toEqual([]);
    expect(splitEvenly(100, 0)).toEqual([]);
  });

  it('always adds up to the exact total', () => {
    for (const total of [1, 99, 100, 101, 4999, 123457, 999999, 1500000]) {
      for (const count of [1, 2, 3, 6, 7, 12, 59]) {
        expect(sum(splitEvenly(total, count).map((amount) => ({ amount }))), `${total}/${count}`).toBe(total);
      }
    }
  });
});

describe('buildMonthlyPlan', () => {
  it('a deposit today, then monthly payments from the first date', () => {
    expect(buildMonthlyPlan({ totalCents: 600000, depositCents: 150000, firstDate: '2026-11-15', count: 3, today: TODAY })).toEqual([
      { amount: 150000, date: TODAY },
      { amount: 150000, date: '2026-11-15' },
      { amount: 150000, date: '2026-12-15' },
      { amount: 150000, date: '2027-01-15' },
    ]);
  });

  it('without a deposit, the first equal payment is due today', () => {
    expect(buildMonthlyPlan({ totalCents: 300000, depositCents: 0, firstDate: '2026-11-01', count: 2, today: TODAY })).toEqual([
      { amount: 100000, date: TODAY },
      { amount: 100000, date: '2026-11-01' },
      { amount: 100000, date: '2026-12-01' },
    ]);
  });

  it('keeps a 31st anchor through short months', () => {
    const p = buildMonthlyPlan({ totalCents: 300000, depositCents: 100000, firstDate: '2027-01-31', count: 3, today: TODAY });
    expect(p.map((x) => x.date)).toEqual([TODAY, '2027-01-31', '2027-02-28', '2027-03-31']);
  });

  it('never takes a deposit above the total', () => {
    const p = buildMonthlyPlan({ totalCents: 1000, depositCents: 5000, firstDate: '2026-11-01', count: 2, today: TODAY });
    expect(p[0].amount).toBe(1000);
  });
});

describe('planPayments', () => {
  it('reads and cleans the saved schedule', () => {
    expect(planPayments({ installments: [{ amount: '1500.4', date: '2026-10-01' }, { amount: 2000, date: 'soon' }] })).toEqual([
      { amount: 1500, date: '2026-10-01' },
      { amount: 2000, date: 'soon' },
    ]);
    expect(planPayments(null)).toEqual([]);
    expect(planPayments({ installments: 'x' })).toEqual([]);
    expect(Number.isNaN(planPayments({ installments: [{ amount: 'abc', date: TODAY }] })[0].amount)).toBe(true);
  });
});

describe('paymentTermsError', () => {
  const plan = (installments: Array<{ amount: number; date: string }>, priceCents = sum(installments)) =>
    paymentTermsError({ priceCents, paymentType: 'installment', paymentConfig: { installments }, today: TODAY });

  it('accepts pay in full and a valid plan', () => {
    expect(paymentTermsError({ priceCents: 500000, paymentType: 'full', paymentConfig: {} })).toBeNull();
    expect(paymentTermsError({ priceCents: 500000, paymentType: null, paymentConfig: { due_date: '2026-12-01' } })).toBeNull();
    expect(plan([{ amount: 100000, date: TODAY }, { amount: 400000, date: '2027-01-01' }])).toBeNull();
  });

  it('refuses subscriptions and unknown types', () => {
    expect(paymentTermsError({ priceCents: 1, paymentType: 'subscription', paymentConfig: {} })).toMatch(/aren’t available/);
    expect(paymentTermsError({ priceCents: 1, paymentType: 'weekly', paymentConfig: {} })).toMatch(/Pay in full or a payment plan/);
  });

  it('refuses a bad due date', () => {
    expect(paymentTermsError({ priceCents: 1, paymentType: 'full', paymentConfig: { due_date: '2026-02-30' } })).toMatch(/due date/);
  });

  it('explains every plan problem in plain words', () => {
    expect(plan([{ amount: 100000, date: TODAY }])).toMatch(/at least 2 payments/);
    expect(plan([{ amount: 100000, date: TODAY }, { amount: 0, date: '2027-01-01' }])).toBe('Payment 2 needs an amount.');
    expect(plan([{ amount: 100000, date: TODAY }, { amount: 49, date: '2027-01-01' }])).toBe('Payment 2 must be at least $0.50.');
    expect(plan([{ amount: 100000, date: TODAY }, { amount: 5000, date: 'nope' }])).toBe('Payment 2 needs a date.');
    expect(plan([{ amount: 100000, date: '2027-02-01' }, { amount: 5000, date: '2027-01-01' }])).toMatch(/Payment 2 is dated before payment 1/);
    expect(plan([{ amount: 100000, date: '2026-09-01' }, { amount: 5000, date: '2026-09-15' }])).toBe('Payment 2 is dated in the past.');
    expect(plan([{ amount: 100000, date: TODAY }, { amount: 400000, date: '2027-01-01' }], 600000)).toBe(
      'The payments add up to $5,000.00, but the total is $6,000.00. Adjust the payments so they match.',
    );
    const many = Array.from({ length: MAX_PLAN_PAYMENTS + 1 }, (_, i) => ({ amount: 100, date: addMonthsYmd(TODAY, i) }));
    expect(plan(many)).toMatch(/up to 60 payments/);
  });

  it('allows a day of slack for an earlier time zone', () => {
    expect(plan([{ amount: 100000, date: '2026-09-30' }, { amount: 5000, date: '2026-09-30' }])).toBeNull();
  });
});

describe('termsFingerprint', () => {
  const cfg = { installments: [{ amount: 1000, date: TODAY }, { amount: 2000, date: '2027-01-01' }], plan: { kind: 'custom' } };

  it('changes with money terms only', () => {
    const base = termsFingerprint(3000, 'installment', cfg);
    expect(termsFingerprint(3000, 'installment', { ...cfg, plan: { kind: 'monthly' } })).toBe(base);
    expect(termsFingerprint(3100, 'installment', cfg)).not.toBe(base);
    expect(termsFingerprint(3000, 'full', cfg)).not.toBe(base);
    expect(termsFingerprint(3000, 'installment', { installments: [{ amount: 1000, date: TODAY }, { amount: 2000, date: '2027-01-02' }] })).not.toBe(base);
  });
});

describe('plan builder', () => {
  const draft = (over: Partial<PlanDraft>): PlanDraft => ({ ...defaultPlanDraft(TODAY), ...over });

  it('reads dollar inputs', () => {
    expect(dollarsToCents('$1,234.56')).toBe(123456);
    expect(dollarsToCents('19.99')).toBe(1999);
    expect(dollarsToCents(97)).toBe(9700);
    for (const bad of ['', 'abc', null, undefined]) expect(dollarsToCents(bad)).toBe(0);
  });

  it('works out deposits by percent or amount', () => {
    expect(planDepositCents(draft({ depositMode: 'percent', deposit: '25' }), 600000)).toBe(150000);
    expect(planDepositCents(draft({ depositMode: 'percent', deposit: '150' }), 600000)).toBe(600000);
    expect(planDepositCents(draft({ depositMode: 'percent', deposit: 'x' }), 600000)).toBe(0);
    expect(planDepositCents(draft({ depositMode: 'amount', deposit: '$500' }), 600000)).toBe(50000);
    expect(planDepositCents(draft({ depositMode: 'amount', deposit: '-5' }), 600000)).toBe(0);
  });

  it('ends a plan days before the wedding or on a picked date', () => {
    expect(planEndDate(draft({ endMode: 'event', eventDate: '2027-06-12', daysBefore: '30' }))).toBe('2027-05-13');
    expect(planEndDate(draft({ endMode: 'event', eventDate: '', daysBefore: '30' }))).toBeNull();
    expect(planEndDate(draft({ endMode: 'date', endDate: '2027-03-01' }))).toBe('2027-03-01');
  });

  it('builds a monthly plan that matches the total', () => {
    const r = planFromDraft(draft({ kind: 'monthly', depositMode: 'percent', deposit: '25', firstDate: '2026-11-01', endMode: 'count', count: '6' }), 600000, TODAY);
    expect(r.problem).toBeNull();
    expect(r.payments).toHaveLength(7);
    expect(r.payments[0]).toEqual({ amount: 150000, date: TODAY });
    expect(sum(r.payments)).toBe(600000);
  });

  it('builds a monthly plan through 30 days before the wedding', () => {
    const r = planFromDraft(draft({ kind: 'monthly', deposit: '0', firstDate: '2026-11-01', endMode: 'event', eventDate: '2027-06-12', daysBefore: '30' }), 800000, TODAY);
    expect(r.problem).toBeNull();
    expect(r.payments.at(-1)?.date).toBe('2027-05-01');
    expect(sum(r.payments)).toBe(800000);
  });

  it('builds a deposit + final plan', () => {
    const r = planFromDraft(draft({ kind: 'deposit_final', depositMode: 'amount', deposit: '1000', endMode: 'date', endDate: '2027-05-01' }), 500000, TODAY);
    expect(r).toEqual({ payments: [{ amount: 100000, date: TODAY }, { amount: 400000, date: '2027-05-01' }], problem: null });
  });

  it('dates custom payment 1 today unless the venue collects by hand', () => {
    const rows = [{ amount: '1000', date: '2026-12-01' }, { amount: '4000', date: '2027-02-01' }];
    expect(planFromDraft(draft({ kind: 'custom', rows }), 500000, TODAY).payments[0].date).toBe(TODAY);
    expect(planFromDraft(draft({ kind: 'custom', rows }), 500000, TODAY, { collectManually: true }).payments[0].date).toBe('2026-12-01');
  });

  it('explains problems instead of building a bad plan', () => {
    expect(planFromDraft(draft({}), 0, TODAY).problem).toMatch(/Add line items first/);
    expect(planFromDraft(draft({ depositMode: 'amount', deposit: '7000' }), 600000, TODAY).problem).toMatch(/more than the total/);
    expect(planFromDraft(draft({ depositMode: 'percent', deposit: '100' }), 600000, TODAY).problem).toMatch(/Choose Pay in full/);
    expect(planFromDraft(draft({ firstDate: TODAY }), 600000, TODAY).problem).toMatch(/after today/);
    expect(planFromDraft(draft({ endMode: 'count', count: '0' }), 600000, TODAY).problem).toMatch(/how many monthly payments/);
    expect(planFromDraft(draft({ kind: 'deposit_final', deposit: '0' }), 600000, TODAY).problem).toMatch(/deposit due at signing/);
    expect(planFromDraft(draft({ kind: 'custom', rows: [{ amount: '1000', date: '' }, { amount: '1000', date: '2027-01-01' }] }), 600000, TODAY).problem).toMatch(/add up to/);
  });
});
