import { beforeEach, describe, expect, it, vi } from 'vitest';

// The nightly tag sweep. Oct 6 2026: it took 68 seconds on the test copy and
// failed the full check, because it did everything one at a time: a table
// check for each venue, a lookup for each open proposal, another for each
// recent reply. It now does a few at a time. Tags start automations, so what
// it tags must be exactly what it tagged before: this runs the whole sweep
// against a stand-in database and holds every tag it applies and removes.

type Row = Record<string, unknown>;
type Call = [method: string, ...args: unknown[]];
let db: { leads: Row[]; proposals: Row[]; coldTagged: string[] };

/** A stand-in for the database's query builder: it applies the filters the sweep asks for. */
function query(table: string) {
  const calls: Call[] = [];
  const rows = (): Row[] => {
    if (table === 'lead_tag_assignments') {
      const leadId = calls.find((c) => c[0] === 'eq' && c[1] === 'lead_id')?.[2] as string;
      return db.coldTagged.includes(leadId) ? [{ tag_id: 'tag' }] : [];
    }
    let out = table === 'proposals' ? db.proposals : db.leads;
    for (const [m, col, val] of calls as Array<[string, string, unknown]>) {
      if (m === 'eq') out = out.filter((r) => r[col] === val);
      if (m === 'gte') out = out.filter((r) => r[col] != null && String(r[col]) >= String(val));
      if (m === 'lte') out = out.filter((r) => r[col] != null && String(r[col]) <= String(val));
      if (m === 'lt') out = out.filter((r) => r[col] != null && String(r[col]) < String(val));
      if (m === 'in') out = out.filter((r) => (val as unknown[]).includes(r[col]));
      if (m === 'ilike') out = out.filter((r) => String(r[col] ?? '').toLowerCase() === String(val).toLowerCase());
      if (m === 'not' && val === 'is') out = out.filter((r) => r[col] != null);
    }
    return out;
  };
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'not', 'gte', 'lte', 'lt', 'order', 'limit', 'eq', 'in', 'ilike']) {
    b[m] = (...args: unknown[]) => { calls.push([m, ...args]); return b; };
  }
  b.maybeSingle = async () => ({ data: rows()[0] ?? null });
  b.then = (resolve: (v: { data: Row[] }) => unknown) => resolve({ data: rows() });
  return b;
}

const applied: string[] = [];
const removed: string[] = [];
const ensured: string[] = [];
let ensuring = 0;
let mostEnsuringAtOnce = 0;
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: (table: string) => query(table) } }));
vi.mock('@/lib/system-tags', () => ({
  applySystemTag: async (venue: string, lead: string, key: string) => { applied.push(`${venue}/${lead}/${key}`); },
  removeSystemTag: async (venue: string, lead: string, key: string) => { removed.push(`${venue}/${lead}/${key}`); },
  ensureSystemTagsForVenue: async (venue: string) => {
    ensuring += 1;
    mostEnsuringAtOnce = Math.max(mostEnsuringAtOnce, ensuring);
    await new Promise((r) => setTimeout(r, 2));
    ensured.push(venue);
    ensuring -= 1;
  },
}));
const sweep = await import('@/lib/tag-sweep');

const NOW = new Date('2026-10-06T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const day = (n: number) => daysAgo(-n).slice(0, 10);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  applied.length = 0; removed.length = 0; ensured.length = 0; ensuring = 0; mostEnsuringAtOnce = 0;
  const lead = (id: string, venue_id: string, more: Row = {}): Row =>
    ({ id, venue_id, email: `${id}@example.com`, wedding_date: null, updated_at: daysAgo(1), last_inbound_at: null, ...more });
  db = {
    leads: [
      lead('soon', 'A', { wedding_date: day(3) }),
      lead('this-month', 'A', { wedding_date: day(19) }),
      lead('married', 'B', { wedding_date: day(-35) }),
      lead('a-year-on', 'B', { wedding_date: day(-365) }),
      lead('silent', 'C', { updated_at: daysAgo(60) }),
      lead('silent-but-wrote', 'C', { updated_at: daysAgo(60), last_inbound_at: daysAgo(10) }),
      lead('cooling', 'C', { updated_at: daysAgo(35) }),
      lead('back', 'D', { last_inbound_at: daysAgo(0.1) }),
      lead('chatty', 'D', { last_inbound_at: daysAgo(0.1) }),
      lead('owes', 'E', { email: 'kim@example.com' }),
      lead('overdue', 'E', { email: 'lee@example.com' }),
    ],
    proposals: [
      { id: 'p1', venue_id: 'E', customer_email: 'Kim@Example.com', status: 'sent', signed_at: null },
      { id: 'p2', venue_id: 'E', customer_email: 'lee@example.com', status: 'signed', signed_at: daysAgo(10) },
      { id: 'p3', venue_id: 'F', customer_email: 'nobody@example.com', status: 'opened', signed_at: null },
      { id: 'p4', venue_id: 'G', customer_email: 'not an email', status: 'sent', signed_at: null },
      { id: 'p5', venue_id: 'E', customer_email: 'kim@example.com', status: 'paid', signed_at: daysAgo(40) },
    ],
    coldTagged: ['back'],
  };
});

describe('the nightly tag sweep tags what it always tagged', () => {
  it('every tag it applies and removes, lead by lead', async () => {
    const counts = await sweep.runTagSweep();
    await new Promise((r) => setTimeout(r, 5)); // the tags themselves are not waited for
    expect([...applied].sort()).toEqual([
      'A/soon/within_30_days', 'A/soon/within_7_days',
      'A/this-month/within_30_days',
      'B/a-year-on/anniversary_year_1', 'B/a-year-on/event_passed',
      'B/married/event_passed',
      'C/cooling/cold_lead',
      'C/silent/cold_lead', 'C/silent/inactive',
      'D/back/re_engaged',
      'E/overdue/balance_due', 'E/overdue/past_due',
      'E/owes/balance_due',
    ]);
    expect([...removed].sort()).toEqual([
      'A/this-month/within_7_days',
      'B/a-year-on/within_30_days', 'B/a-year-on/within_7_days',
      'B/married/within_30_days', 'B/married/within_7_days',
      'D/back/cold_lead', 'D/back/inactive',
    ]);
    expect(counts).toEqual({
      within_30_days: 2, within_7_days: 1, event_passed: 2, anniversary_year_1: 1,
      inactive: 1, cold_lead: 2, balance_due: 2, past_due: 1, re_engaged: 1,
    });
  });

  it('a venue’s tags are made sure of before any of its leads is tagged, and never for a proposal with no email', async () => {
    await sweep.runTagSweep();
    expect([...new Set(ensured)].sort()).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(ensured).not.toContain('G');
  });
});

describe('it no longer does one thing at a time', () => {
  it('a few lookups at once, never more than the limit, and it waits for all of them', async () => {
    expect(sweep.SWEEP_AT_ONCE).toBeGreaterThan(1);
    expect(sweep.SWEEP_AT_ONCE).toBeLessThanOrEqual(10);
    let running = 0; let most = 0; const done: number[] = [];
    await sweep.aFewAtATime(Array.from({ length: 30 }, (_, i) => i), async (i) => {
      running += 1; most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 2));
      done.push(i); running -= 1;
    });
    expect(done.sort((a, b) => a - b)).toEqual(Array.from({ length: 30 }, (_, i) => i));
    expect(most).toBe(sweep.SWEEP_AT_ONCE);
    await sweep.aFewAtATime([], async () => { throw new Error('nothing to do'); });
  });

  it('venues are made ready several at a time', async () => {
    db.leads = Array.from({ length: 24 }, (_, i) => ({ id: `l${i}`, venue_id: `v${i}`, email: `l${i}@example.com`, wedding_date: day(3), updated_at: daysAgo(1), last_inbound_at: null }));
    db.proposals = [];
    await sweep.runTagSweep();
    expect(new Set(ensured).size).toBe(24);
    expect(mostEnsuringAtOnce).toBe(sweep.SWEEP_AT_ONCE);
  });
});
