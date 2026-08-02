/**
 * Tiny module-level cache for client pages (stale-while-revalidate).
 *
 * Next.js client-side navigation unmounts a page component when you leave a
 * tab and remounts it fresh when you come back, so every tab switch used to
 * start from an empty skeleton while data refetched. This module survives
 * navigation (it lives for the whole webview/browser session), letting pages
 * paint their previous data instantly and refresh quietly in the background.
 *
 * Not persisted anywhere — a full page reload starts clean, so there's no
 * staleness risk beyond the current session.
 */

const store = new Map<string, unknown>();

export function getClientCache<T>(key: string): T | undefined {
  return store.get(key) as T | undefined;
}

export function setClientCache<T>(key: string, value: T): void {
  store.set(key, value);
}
