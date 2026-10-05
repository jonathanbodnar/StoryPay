import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IDS_PER_REQUEST, inBatches } from '@/lib/in-batches';

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
