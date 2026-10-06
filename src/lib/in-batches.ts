/**
 * A long list of ids, in batches short enough to ask the database about in
 * one request.
 *
 * PostgREST takes a filter's values in the request's address, and Node won't
 * send a request whose address and headers pass 16 KB: the call fails with
 * "TypeError: fetch failed" before it leaves the server. That is about 430
 * ids. Oct 5 2026: Support Analytics stopped loading on the test copy the
 * moment it had 452 venues to ask about; the same wall was waiting for the
 * live app as it grew. 100 ids is under 4,000 characters.
 */
export const IDS_PER_REQUEST = 100;

export function inBatches<T>(items: readonly T[], size: number = IDS_PER_REQUEST): T[][] {
  const per = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += per) out.push(items.slice(i, i + per));
  return out;
}

/**
 * Ask the database about a long list of ids, a batch at a time, and hand back
 * every row. `ask` is given one batch and returns the query for it. The first
 * failure stops it and is returned, with whatever was read before it.
 *
 * Rows come back batch by batch: every row about one id is in the same batch,
 * in the order its query gave, but the batches are not sorted against each
 * other.
 */
export async function askInBatches<Row>(
  ids: readonly string[],
  ask: (batch: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  size: number = IDS_PER_REQUEST,
): Promise<{ data: Row[]; error: { message: string } | null }> {
  const data: Row[] = [];
  for (const batch of inBatches(ids, size)) {
    const res = await ask(batch);
    if (res.error) return { data, error: res.error };
    if (Array.isArray(res.data)) data.push(...(res.data as Row[]));
  }
  return { data, error: null };
}
