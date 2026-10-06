import { beforeEach, describe, expect, it, vi } from 'vitest';

// Making sure a venue has its system tags used to re-run a check of the TABLE
// itself (add the columns and the index if they're missing) for every venue,
// one after another, each taking a lock on the tags table. With a few hundred
// venues that was most of a minute of the nightly tag sweep (Oct 6 2026: 68
// seconds on the test copy, which failed the full check). The table is checked
// once per process now; each venue's own tags are still looked at.

const tableChecks = vi.fn<(sql: string) => Promise<undefined>>(async () => undefined);
const connect = vi.fn(async () => ({ unsafe: tableChecks }));
const lookedAt: string[] = [];
const inserted: unknown[][] = [];
vi.mock('@/lib/db', () => ({ getDbAsync: connect }));
vi.mock('@/lib/marketing-email-worker', () => ({ onMarketingTagAdded: vi.fn() }));
vi.mock('@/lib/integration-events', () => ({ dispatchIntegrationEvent: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = (_col: string, venueId: string) => { lookedAt.push(venueId); return b; };
      b.not = async () => ({ data: [] }); // this venue has none of its system tags yet
      b.insert = async (rows: unknown[]) => { inserted.push(rows); return { error: null }; };
      return b;
    },
  },
}));

beforeEach(() => {
  vi.resetModules();
  tableChecks.mockClear(); connect.mockClear(); connect.mockImplementation(async () => ({ unsafe: tableChecks }));
  lookedAt.length = 0; inserted.length = 0;
});

describe('a venue’s system tags', () => {
  it('the table is checked once, however many venues are made ready, one by one or together', async () => {
    const { ensureSystemTagsForVenue } = await import('@/lib/system-tags');
    for (const venue of ['a', 'b', 'c']) await ensureSystemTagsForVenue(venue);
    await Promise.all(['d', 'e', 'f', 'g'].map((venue) => ensureSystemTagsForVenue(venue)));
    expect(tableChecks).toHaveBeenCalledTimes(1);
    expect(String(tableChecks.mock.calls[0][0])).toMatch(/ALTER TABLE public\.marketing_tags/);
    // Every venue still had its own tags looked at, and the missing ones added.
    expect([...lookedAt].sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    expect(inserted).toHaveLength(7);
    expect((inserted[0] as Array<{ system_key: string }>).map((r) => r.system_key)).toContain('balance_due');
  });

  it('a venue already made ready is not looked at again', async () => {
    const { ensureSystemTagsForVenue } = await import('@/lib/system-tags');
    await ensureSystemTagsForVenue('a');
    await ensureSystemTagsForVenue('a');
    expect(lookedAt).toEqual(['a']);
  });

  it('no database connection: that venue is not marked ready, and the next call tries the table check again', async () => {
    const { ensureSystemTagsForVenue } = await import('@/lib/system-tags');
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    connect.mockRejectedValueOnce(new Error('no connection'));
    await ensureSystemTagsForVenue('a');
    expect(lookedAt).toEqual([]);
    await ensureSystemTagsForVenue('a');
    expect(connect).toHaveBeenCalledTimes(2);
    expect(tableChecks).toHaveBeenCalledTimes(1);
    expect(lookedAt).toEqual(['a']);
    quiet.mockRestore();
  });
});
