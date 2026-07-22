/**
 * IndexNow ping helper.
 *
 * Notifies Bing (and every IndexNow-participating engine — Yandex, Seznam,
 * Naver) the moment a listing URL goes live or changes. Bing's index is what
 * ChatGPT search uses, so this is the fastest AEO entry point we have.
 *
 * The key is not a secret — it only proves domain ownership. The homepage app
 * serves it at https://storyvenue.com/indexnow.txt (see
 * homepage/src/app/indexnow.txt/route.ts). Override with INDEXNOW_KEY in both
 * services if you ever want to rotate it.
 */

export const INDEXNOW_DEFAULT_KEY = 'f3b1a9d47c2e48e5a6d0b8c1e9f7a234';

const DIRECTORY_SITE = (process.env.NEXT_PUBLIC_DIRECTORY_URL || 'https://storyvenue.com').replace(/\/$/, '');

function indexNowKey(): string {
  return (process.env.INDEXNOW_KEY || INDEXNOW_DEFAULT_KEY).trim();
}

/**
 * Ping IndexNow with one or more URLs on the directory domain.
 * Fire-and-forget safe; never throws.
 */
export async function pingIndexNow(urls: string[]): Promise<void> {
  if (!urls.length) return;
  try {
    const host = new URL(DIRECTORY_SITE).host;
    const key = indexNowKey();
    const res = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host,
        key,
        keyLocation: `${DIRECTORY_SITE}/indexnow.txt`,
        urlList: urls.slice(0, 10_000),
      }),
    });
    if (!res.ok && res.status !== 202) {
      console.warn('[indexnow] ping failed:', res.status, await res.text().catch(() => ''));
    }
  } catch (err) {
    console.warn('[indexnow] ping error:', err);
  }
}

/** Convenience: ping a single venue listing URL by slug. */
export async function pingVenueUrl(slug: string): Promise<void> {
  await pingIndexNow([`${DIRECTORY_SITE}/venue/${slug}`]);
}
