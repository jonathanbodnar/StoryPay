/**
 * Before the flow tests: the test copy goes quiet (emails nobody, not even
 * approved addresses; everything still lands in its outbox) for the run.
 */
export default async function setup(): Promise<void> {
  const base = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '');
  if (process.env.APP_ENV !== 'staging' || !base) return; // helpers.ts refuses to run anyway
  const res = await fetch(`${base}/api/staging/outbox`, {
    method: 'POST',
    headers: { 'x-staging-key': process.env.STAGING_PASSWORD || '', 'content-type': 'application/json' },
    body: JSON.stringify({ quietMinutes: 90 }),
  });
  if (!res.ok) throw new Error(`Could not put the test copy in quiet mode: ${res.status}`);
}
