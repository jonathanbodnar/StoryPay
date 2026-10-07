/**
 * The Support Inbox's list as the admin has loaded it: the newest page, plus
 * whatever "Load more" added below it.
 *
 * Until Oct 7 2026 every reload of the newest page REPLACED the list, and a
 * reload happened whenever a row was opened (and every 20 seconds, and when
 * the browser tab came back into view). So an admin who loaded older leads and
 * opened one was put back at the newest fifty, and "Load more" then carried on
 * from where the dropped rows had ended, skipping them.
 *
 * A reload of the newest page is laid over the list instead: the page is
 * taken as it is, and the older rows already loaded stay where they were.
 */

export interface InboxListRow {
  thread_id: string;
  /** The list's order: latest first (then thread id), as the server sorts it. */
  last_inbound_created_at: string;
}

const at = (row: InboxListRow) => {
  const t = Date.parse(row.last_inbound_created_at);
  return Number.isFinite(t) ? t : 0;
};

/** Does `row` come after `other` in the list (is it older)? */
function comesAfter(row: InboxListRow, other: InboxListRow): boolean {
  if (at(row) !== at(other)) return at(row) < at(other);
  return row.thread_id < other.thread_id;
}

/**
 * The list after the newest page was loaded again.
 *
 *  - Rows on the page are shown as the page has them (new previews, new order).
 *  - Rows loaded earlier that are older than everything on the page (the
 *    admin's "Load more" rows) are kept.
 *  - A row loaded earlier that belongs in the page's stretch and isn't on it
 *    has left the list (answered, closed), and goes.
 *
 * When the page is the whole list (nothing after it), the page is the list.
 */
export function refreshedList<T extends InboxListRow>(loaded: readonly T[], newestPage: readonly T[], moreAfterPage: boolean): T[] {
  if (!moreAfterPage || newestPage.length === 0) return [...newestPage];
  const onPage = new Set(newestPage.map((r) => r.thread_id));
  const last = newestPage[newestPage.length - 1];
  return [...newestPage, ...loaded.filter((r) => !onPage.has(r.thread_id) && comesAfter(r, last))];
}

/**
 * The list with a further page added below. A row that is already loaded (it
 * moved while the admin was reading) isn't shown a second time.
 */
export function withNextPage<T extends InboxListRow>(loaded: readonly T[], page: readonly T[]): T[] {
  const have = new Set(loaded.map((r) => r.thread_id));
  return [...loaded, ...page.filter((r) => !have.has(r.thread_id))];
}
