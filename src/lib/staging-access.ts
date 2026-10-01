/**
 * The test copy's password (APP_ENV=staging, STAGING_PASSWORD). The proxy lets
 * a request through with the access cookie set by /staging-access, or with an
 * `x-staging-key` header (test robots). Webhooks and timers carry their own
 * secrets; images and robots.txt are public.
 */

export const STAGING_ACCESS_COOKIE = 'sv_staging_access';

/** The cookie value: proves the password without holding it. */
export async function stagingAccessToken(password: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    'raw', enc.encode(password), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, enc.encode('storyvenue-staging-access-v1')));
  let bin = '';
  for (const b of sig) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Constant-time string compare. */
export function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

/** Paths that skip the password page. */
export function stagingOpenPath(pathname: string): boolean {
  return (
    pathname === '/staging-access' ||
    pathname.startsWith('/api/webhooks/') ||
    pathname.startsWith('/api/cron/') ||
    /\.(png|jpe?g|gif|svg|ico|webp|avif|txt|xml|webmanifest)$/i.test(pathname)
  );
}

/** Where to go after signing in: same-site paths only. */
export function safeNextPath(next: string | null | undefined): string {
  const n = (next ?? '').trim();
  return n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n : '/';
}
