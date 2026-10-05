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
