import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }));
const { pickSweepThreads } = await import('@/lib/ghl-inbound-sync-cron');

type Thread = { threadId: string };
type Pick = { picked: Thread[]; cursor: string | null };
const threads = (ids: string[]): Thread[] => ids.map((threadId) => ({ threadId }));

describe('the reply sync checks every active conversation', () => {
  it('takes the newest few every run and the rest in rotation, so nobody is skipped', () => {
    // Newest first, as the sweep sees them.
    const active = threads(['t09', 't02', 't07', 't01', 't10', 't04', 't06', 't03', 't08', 't05']);
    const seen = new Set<string>();
    let cursor: string | null = null;
    for (let run = 0; run < 2; run++) {
      const run1: Pick = pickSweepThreads(active, 3, 4, cursor);
      expect(run1.picked.slice(0, 3).map((t) => t.threadId)).toEqual(['t09', 't02', 't07']);
      expect(run1.picked).toHaveLength(7);
      run1.picked.forEach((t) => seen.add(t.threadId));
      cursor = run1.cursor;
    }
    expect(seen.size).toBe(10);
  });

  it('keeps going through the rest while the list changes between runs', () => {
    let cursor: string | null = null;
    const seen = new Set<string>();
    const rest = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    for (let run = 0; run < 4; run++) {
      // A different conversation is newest each run; one quiet one drops out after run 1.
      const active = threads([`new${run}`, ...rest.filter((id) => !(run > 1 && id === 'h'))]);
      const r: Pick = pickSweepThreads(active, 1, 3, cursor);
      r.picked.forEach((t) => seen.add(t.threadId));
      cursor = r.cursor;
    }
    for (const id of rest.slice(0, 7)) expect(seen.has(id)).toBe(true);
  });

  it('checks everything each run when there are only a few', () => {
    const { picked } = pickSweepThreads(threads(['x', 'y', 'z']), 2, 10, null);
    expect(picked.map((t) => t.threadId).sort()).toEqual(['x', 'y', 'z']);
  });
});
