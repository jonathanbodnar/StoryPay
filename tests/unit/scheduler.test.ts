import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A stand-in for the admin_kv_cache table, with just the queries claimDay uses.
const kv = vi.hoisted(() => new Map<string, { day?: string }>());
vi.mock('@/lib/supabase', () => {
  function table() {
    let op: 'select' | 'insert' | 'update' = 'select';
    let payload: { key?: string; value?: { day?: string } } = {};
    const filters: Array<[string, unknown]> = [];
    const matches = (key: string) =>
      filters.every(([col, val]) => (col === 'key' ? key === val : col === 'value->>day' ? (kv.get(key)?.day ?? null) === val : true));
    const run = () => {
      if (op === 'insert') {
        if (kv.has(payload.key!)) return { error: { code: '23505', message: 'duplicate key' } };
        kv.set(payload.key!, payload.value!);
        return { error: null };
      }
      if (op === 'update') {
        const hit = [...kv.keys()].filter(matches);
        for (const k of hit) kv.set(k, payload.value!);
        return { data: hit.map((key) => ({ key })), error: null };
      }
      const key = filters.find(([c]) => c === 'key')?.[1] as string;
      return { data: kv.has(key) ? { value: kv.get(key) } : null, error: null };
    };
    const b = {
      select: () => b,
      eq: (c: string, v: unknown) => (filters.push([c, v]), b),
      is: (c: string, v: unknown) => (filters.push([c, v]), b),
      insert: (p: typeof payload) => ((op = 'insert'), (payload = p), b),
      update: (p: typeof payload) => ((op = 'update'), (payload = p), b),
      maybeSingle: async () => run(),
      then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, fail),
    };
    return b;
  }
  return { supabaseAdmin: { from: () => table() } };
});

import { onceDailyAfter } from '@/lib/in-app-scheduler';

beforeEach(() => kv.clear());
afterEach(() => vi.useRealTimers());

describe('daily jobs', () => {
  it('run once a UTC day, on the first check at or after their hour', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const job = vi.fn(async () => 'done');
    const tick = onceDailyAfter(9, 'reminders', job);
    vi.setSystemTime(new Date('2026-10-01T08:59:00Z'));
    expect(await tick()).toBeNull();
    vi.setSystemTime(new Date('2026-10-01T09:04:00Z'));
    expect(await tick()).toBe('done');
    vi.setSystemTime(new Date('2026-10-01T15:00:00Z'));
    expect(await tick()).toBeNull();
    vi.setSystemTime(new Date('2026-10-02T02:00:00Z'));
    expect(await tick()).toBeNull();
    vi.setSystemTime(new Date('2026-10-02T09:10:00Z'));
    expect(await tick()).toBe('done');
    expect(job).toHaveBeenCalledTimes(2);
  });

  it('do not run again after a restart or on a second server the same day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T09:05:00Z'));
    const job = vi.fn(async () => 'done');
    expect(await onceDailyAfter(9, 'reminders', job)()).toBe('done');
    vi.setSystemTime(new Date('2026-10-01T14:00:00Z'));
    expect(await onceDailyAfter(9, 'reminders', job)()).toBeNull(); // the restarted server
    expect(await onceDailyAfter(9, 'reminders', job)()).toBeNull(); // another server
    vi.setSystemTime(new Date('2026-10-02T09:01:00Z'));
    expect(await onceDailyAfter(9, 'reminders', job)()).toBe('done');
    expect(await onceDailyAfter(9, 'reminders', job)()).toBeNull();
    expect(job).toHaveBeenCalledTimes(2);
  });

  it('keep each job’s day separate', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T17:30:00Z'));
    expect(await onceDailyAfter(9, 'reminders', async () => 'a')()).toBe('a');
    expect(await onceDailyAfter(17, 'private-client', async () => 'b')()).toBe('b');
    expect(await onceDailyAfter(3, 'tag-sweep', async () => 'c')()).toBe('c');
  });
});
