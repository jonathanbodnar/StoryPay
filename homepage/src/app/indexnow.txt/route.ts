/**
 * GET /indexnow.txt — serves the IndexNow ownership key.
 *
 * The key is not a secret; it only proves we control this domain so IndexNow
 * pings from the dashboard app are accepted. Keep in sync with
 * src/lib/indexnow.ts in the main app (INDEXNOW_KEY env overrides both).
 */

const INDEXNOW_DEFAULT_KEY = 'f3b1a9d47c2e48e5a6d0b8c1e9f7a234';

export const dynamic = 'force-static';

export async function GET(): Promise<Response> {
  const key = (process.env.INDEXNOW_KEY || INDEXNOW_DEFAULT_KEY).trim();
  return new Response(key, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
