import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { askInBatches, IDS_PER_REQUEST, inBatches } from '@/lib/in-batches';

// Oct 5 2026: Support Analytics → "Funnel Health by Plan Type" stopped loading
// on the test copy the moment it had 452 venues. The route asked for every
// venue's leads in one request, with every venue's id in the address; past
// 16 KB the request is never sent ("TypeError: fetch failed"). Live would have
// hit the same wall as venues were added.
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('long id lists are asked for in batches', () => {
  it('every id is asked for exactly once, in order', () => {
    const ids = Array.from({ length: 452 }, (_, i) => uuid(i));
    const batches = inBatches(ids);
    expect(batches.flat()).toEqual(ids);
    expect(batches).toHaveLength(5);
    expect(batches.map((b) => b.length)).toEqual([100, 100, 100, 100, 52]);
  });

  it('a batch of ids always fits in a request’s address, with room to spare', () => {
    const batch = inBatches(Array.from({ length: 5000 }, (_, i) => uuid(i)))[0];
    expect(batch).toHaveLength(IDS_PER_REQUEST);
    // What PostgREST is sent: in.(id,id,…), each id in quotes once encoded.
    const filter = `venue_id=in.(${batch.map((id) => encodeURIComponent(`"${id}"`)).join(',')})`;
    expect(filter.length).toBeLessThan(8000);
  });

  it('nothing to ask for is no request at all; odd sizes never loop forever', () => {
    expect(inBatches([])).toEqual([]);
    expect(inBatches([1, 2, 3], 0)).toEqual([[1], [2], [3]]);
    expect(inBatches([1, 2, 3], 2.9)).toEqual([[1, 2], [3]]);
    expect(inBatches([1, 2, 3], 50)).toEqual([[1, 2, 3]]);
  });

  it('Support Analytics asks for its venues’ leads that way', () => {
    const route = readFileSync(join(__dirname, '..', '..', 'src/app/api/admin/support/cohort-funnels/route.ts'), 'utf8');
    expect(route).toContain('for (const venueIds of inBatches(allCohortVenueIds))');
    expect(route).not.toMatch(/\.in\('venue_id', allCohortVenueIds/);
  });
});

// Oct 6 2026: the Support Inbox's list of bride replies answered 500 on the
// test copy once the latest replies came from a few hundred conversations: it
// asked about all of them in one request ("TypeError: fetch failed", the same
// wall). The badge next to it asked the same way, and when that failed it
// quietly read zero. Both ask in batches now.
describe('asking the database about a long list of ids', () => {
  const ids = Array.from({ length: 452 }, (_, i) => uuid(i));

  it('every id is asked about once, a batch at a time, and every row comes back', async () => {
    const asked: string[][] = [];
    const res = await askInBatches<{ id: string }>(ids, async (batch) => {
      asked.push(batch);
      return { data: batch.map((id) => ({ id })), error: null };
    });
    expect(res.error).toBeNull();
    expect(asked.map((b) => b.length)).toEqual([100, 100, 100, 100, 52]);
    expect(res.data.map((r) => r.id)).toEqual(ids);
  });

  it('a failure is handed back, not swallowed, and nothing more is asked', async () => {
    let calls = 0;
    const res = await askInBatches<{ id: string }>(ids, async (batch) => {
      calls += 1;
      return calls === 2 ? { data: null, error: { message: 'TypeError: fetch failed' } } : { data: [{ id: batch[0] }], error: null };
    });
    expect(res.error?.message).toBe('TypeError: fetch failed');
    expect(calls).toBe(2);
    expect(res.data).toEqual([{ id: ids[0] }]);
  });

  it('no ids, no request; an answer with no rows is no rows', async () => {
    let calls = 0;
    expect(await askInBatches([], async () => { calls += 1; return { data: [], error: null }; })).toEqual({ data: [], error: null });
    expect(calls).toBe(0);
    expect((await askInBatches(['a'], async () => ({ data: null, error: null }))).data).toEqual([]);
  });

  it('the Support Inbox list and its badge never put a whole list of conversations in one request', () => {
    for (const file of ['src/app/api/admin/support/bride-inbox/route.ts', 'src/app/api/admin/support/inbox-count/route.ts']) {
      const route = readFileSync(join(__dirname, '..', '..', file), 'utf8');
      expect(route, file).toContain("from '@/lib/in-batches'");
      // Every .in(...) on an id column is handed a batch (`ids`), never a whole list.
      const whole = [...route.matchAll(/\.in\('(?:id|thread_id)',\s*(\w+)\)/g)].map((m) => m[1]).filter((name) => name !== 'ids');
      expect(whole, file).toEqual([]);
    }
  });
});
