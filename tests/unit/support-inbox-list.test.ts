import { describe, expect, it } from 'vitest';
import { refreshedList, refreshedListBy, withNextPage, withNextPageBy, type ListOrder } from '@/lib/support-inbox-list';

// Support Inbox, "Load more". An admin loads older leads and opens one; the
// list used to be put back to the newest fifty (and again every 20 seconds),
// because every reload of the newest page replaced everything loaded.
const row = (n: number, minutesAgo = n) => ({
  thread_id: `t${String(n).padStart(3, '0')}`,
  last_inbound_created_at: new Date(Date.UTC(2026, 9, 7, 12, 0, 0) - minutesAgo * 60_000).toISOString(),
  preview: `as loaded ${n}`,
});
const ids = (rows: { thread_id: string }[]) => rows.map((r) => r.thread_id);

describe('the Support Inbox list after its newest page is loaded again', () => {
  const pageOne = [row(1), row(2), row(3)];
  const older = [row(4), row(5), row(6)];
  const loaded = [...pageOne, ...older];

  it('keeps the older rows the admin loaded', () => {
    expect(ids(refreshedList(loaded, pageOne, true))).toEqual(['t001', 't002', 't003', 't004', 't005', 't006']);
  });

  it('shows the newest page as it now is: a new bride on top, new words on a row', () => {
    const fresh = [row(0), { ...row(1), preview: 'she wrote again' }, row(2)];
    const list = refreshedList(loaded, fresh, true);
    // Row 3 was pushed off the page by the new bride: it is older than the page, so it stays.
    expect(ids(list)).toEqual(['t000', 't001', 't002', 't003', 't004', 't005', 't006']);
    expect(list[1].preview).toBe('she wrote again');
  });

  it('a row that left the newest stretch (answered) goes; one that moved up isn’t shown twice', () => {
    // Row 2 was answered; row 5 wrote again and is now the newest.
    const fresh = [{ ...row(5, 0), preview: 'new reply' }, row(1), row(3)];
    const list = refreshedList(loaded, fresh, true);
    expect(ids(list)).toEqual(['t005', 't001', 't003', 't004', 't006']);
    expect(list.filter((r) => r.thread_id === 't005')).toHaveLength(1);
  });

  it('when the newest page is the whole list, the page is the list', () => {
    expect(ids(refreshedList(loaded, pageOne, false))).toEqual(['t001', 't002', 't003']);
    expect(refreshedList(loaded, [], false)).toEqual([]);
  });

  it('a first load, with nothing loaded yet, is just the page', () => {
    expect(ids(refreshedList([], pageOne, true))).toEqual(['t001', 't002', 't003']);
  });

  it('rows at the same moment keep the server’s order (thread id breaks the tie)', () => {
    const same = [{ ...row(9, 3) }, { ...row(8, 3) }, { ...row(7, 3) }];
    // The page ends at t008; t007 has the same time and a lower id, so it is after the page.
    expect(ids(refreshedList(same, [same[0], same[1]], true))).toEqual(['t009', 't008', 't007']);
  });
});

describe('"Load more" adds a page below', () => {
  it('adds the page, and a row already loaded is not shown a second time', () => {
    const loaded = [row(1), row(2), row(3)];
    expect(ids(withNextPage(loaded, [row(3), row(4), row(5)]))).toEqual(['t001', 't002', 't003', 't004', 't005']);
  });
});

// The tickets list is ordered the same way by other names (latest message, then id).
describe('the same rule for the tickets list', () => {
  const ORDER: ListOrder<{ id: string; last_message_at: string }> = { id: (t) => t.id, at: (t) => t.last_message_at };
  const ticket = (n: number, minutesAgo = n) => ({ id: `k${n}`, last_message_at: new Date(Date.UTC(2026, 9, 7, 12, 0, 0) - minutesAgo * 60_000).toISOString() });

  it('a brand-new ticket reloads the newest page, and the older tickets loaded stay', () => {
    const loaded = [ticket(1), ticket(2), ticket(3), ticket(4)];
    const fresh = [ticket(0), ticket(1)];
    expect(refreshedListBy(ORDER, loaded, fresh, true).map((t) => t.id)).toEqual(['k0', 'k1', 'k2', 'k3', 'k4']);
  });

  it('"Load more" adds to the list as it is now, once each', () => {
    expect(withNextPageBy(ORDER, [ticket(1), ticket(2)], [ticket(2), ticket(3)]).map((t) => t.id)).toEqual(['k1', 'k2', 'k3']);
  });
});
