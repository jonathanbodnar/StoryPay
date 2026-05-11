/* StoryVenue™ service worker
 *
 * Goals:
 *   1. Make the app officially installable (Chrome / Edge / Android PWA) by
 *      providing a fetch handler.
 *   2. Render an offline fallback for top-level navigations so the app icon
 *      on the home screen never opens to a Chrome error page.
 *   3. Speed up repeat visits by cache-first-ing hashed static assets that
 *      we already serve with a 1-year immutable Cache-Control.
 *
 * Intentionally avoided:
 *   - Caching anything under /api/* — these are private, often POST, and
 *     already sent with `Cache-Control: private, no-store` by next.config.
 *   - Caching /dashboard/* pages — user-specific RSC payloads. Always go to
 *     network.
 *   - Intercepting non-GET requests — caches.match() can only serve GET, and
 *     re-issuing POST/PUT from a SW breaks request body streams.
 *
 * Push notification handlers will be appended in a follow-up PR once the
 * `push_subscriptions` table and VAPID keys exist.
 */

const CACHE_VERSION = 'v1';
const STATIC_CACHE = `storyvenue-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `storyvenue-runtime-${CACHE_VERSION}`;
const OFFLINE_URL = '/offline';

// Minimal shell precached on install. Keep this list small — bigger lists
// fail the whole install if any single request 404s on a new deploy.
const PRECACHE_URLS = [
  OFFLINE_URL,
  '/manifest.json',
  '/storyvenue-sidebar-mark.png',
];

// ── install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      // addAll is atomic — failure on one URL would abort install. Use a
      // tolerant loop so a missing icon never blocks the whole worker.
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: 'reload' }));
          } catch (err) {
            // Non-fatal: precache miss should not abort install.
            // eslint-disable-next-line no-console
            console.warn('[sw] precache miss', url, err);
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

// ── activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== STATIC_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k)),
      );
      // Take control of all open tabs immediately so the first install does
      // not require a full reload to start using the SW.
      await self.clients.claim();
    })(),
  );
});

// ── message: allow the page to trigger an immediate update ──────────────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── fetch routing helpers ───────────────────────────────────────────────────
function isHashedStatic(url) {
  // Next.js content-hashes everything under /_next/static — safe forever.
  return url.pathname.startsWith('/_next/static/');
}

function isPublicAsset(url) {
  // Static logos, icons, fonts in /public.
  return /\.(?:png|jpe?g|webp|avif|svg|ico|woff2?|ttf|otf)$/i.test(url.pathname);
}

function isApi(url) {
  return url.pathname.startsWith('/api/');
}

function isAuthArea(url) {
  return (
    url.pathname.startsWith('/dashboard') ||
    url.pathname.startsWith('/admin') ||
    url.pathname.startsWith('/proposal') ||
    url.pathname.startsWith('/invoice') ||
    url.pathname.startsWith('/couple')
  );
}

// ── fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only GET. Anything else (POST proposal signature, PUT, DELETE) must hit
  // the network directly — the SW must never replay request bodies.
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  // Cross-origin (Supabase storage, Cloudinary, randomuser.me, etc.):
  // let the browser handle these natively. We don't want to mask CORS errors
  // or interfere with signed-URL freshness.
  if (url.origin !== self.location.origin) return;

  // API: never cache. Forward as-is so auth cookies and no-store headers stay
  // in effect.
  if (isApi(url)) return;

  // Authenticated app surfaces: always go to network. We do NOT serve
  // /dashboard from cache because every render is user-specific.
  if (isAuthArea(url)) {
    event.respondWith(
      fetch(req).catch(async () => {
        // Only render the offline page for top-level document navigations.
        if (req.mode === 'navigate') {
          const cached = await caches.match(OFFLINE_URL);
          if (cached) return cached;
        }
        return Response.error();
      }),
    );
    return;
  }

  // Hashed Next.js static assets — cache-first, they're immutable.
  if (isHashedStatic(url)) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }

  // Public images / fonts — stale-while-revalidate gives instant repeat
  // paints while keeping the cache fresh in the background.
  if (isPublicAsset(url)) {
    event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
    return;
  }

  // Top-level HTML navigations on public marketing pages: network-first with
  // offline fallback so the home-screen icon never opens to a hard error.
  if (req.mode === 'navigate') {
    event.respondWith(networkFirstWithOffline(req));
    return;
  }

  // Default: just pass through.
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    // No fallback for missing static — surface the failure to the browser.
    throw err;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((res) => {
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  return cached || (await networkPromise) || Response.error();
}

async function networkFirstWithOffline(request) {
  try {
    const res = await fetch(request);
    return res;
  } catch {
    const cached = await caches.match(OFFLINE_URL);
    if (cached) return cached;
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}
