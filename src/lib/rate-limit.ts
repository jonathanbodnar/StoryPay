/**
 * In-memory sliding-window rate limiter.
 *
 * Designed for low-traffic abuse prevention (auth endpoints, public form
 * submission, password reset, etc.) — NOT for high-throughput limiting.
 *
 * Caveats:
 *  - Per-instance: on Railway with multiple replicas, an attacker hitting
 *    different instances gets up to N×limit. Acceptable for week-one
 *    launch; swap to Redis (e.g. Upstash) before scaling out.
 *  - Resets on deploy/restart. Acceptable for the same reason.
 *  - Memory is bounded by `MAX_KEYS`; oldest entries evict on overflow.
 *
 * Always allow when behind a proxy without a usable IP — better to let a
 * legitimate user through than to block them on infra.
 */

import type { NextRequest } from 'next/server';

interface Entry {
  /** Unix-ms timestamps of recent hits, oldest first. */
  hits: number[];
  /** When this key was last touched (for LRU eviction). */
  touchedAt: number;
}

const buckets = new Map<string, Entry>();
const MAX_KEYS = 50_000;

// Cloudflare's published edge ranges (https://www.cloudflare.com/ips/).
const CLOUDFLARE_V4 = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18',
  '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17',
  '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
];
const CLOUDFLARE_V6 = [
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32',
  '2a06:98c0::/29', '2c0f:f248::/32',
];

function v4ToInt(ip: string): number | null {
  const p = ip.split('.');
  if (p.length !== 4) return null;
  let n = 0;
  for (const part of p) {
    const x = Number(part);
    if (!Number.isInteger(x) || x < 0 || x > 255) return null;
    n = n * 256 + x;
  }
  return n;
}

function v6ToBigInt(ip: string): bigint | null {
  const [head, tail = ''] = ip.toLowerCase().split('::');
  const a = head ? head.split(':') : [];
  const b = ip.includes('::') ? (tail ? tail.split(':') : []) : [];
  const groups = ip.includes('::') ? [...a, ...Array(8 - a.length - b.length).fill('0'), ...b] : a;
  if (groups.length !== 8) return null;
  let n = BigInt(0);
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    n = (n << BigInt(16)) + BigInt(parseInt(g, 16));
  }
  return n;
}

/** Is this address one of Cloudflare's edge servers? */
export function isCloudflareIp(ip: string): boolean {
  if (ip.includes(':')) {
    const n = v6ToBigInt(ip);
    if (n === null) return false;
    return CLOUDFLARE_V6.some((cidr) => {
      const [base, bits] = cidr.split('/');
      const b = v6ToBigInt(base);
      if (b === null) return false;
      const shift = BigInt(128 - Number(bits));
      return (n >> shift) === (b >> shift);
    });
  }
  const n = v4ToInt(ip);
  if (n === null) return false;
  return CLOUDFLARE_V4.some((cidr) => {
    const [base, bits] = cidr.split('/');
    const b = v4ToInt(base);
    if (b === null) return false;
    const size = 2 ** (32 - Number(bits));
    return Math.floor(n / size) === Math.floor(b / size);
  });
}

/**
 * The visitor's IP address.
 *
 * app.storyvenue.com sits behind Cloudflare, and Railway's edge sets
 * X-Forwarded-For to the address that connected to it, which is Cloudflare's
 * edge server, not the visitor. When that connecting address is a Cloudflare
 * server, the visitor is in CF-Connecting-IP (Cloudflare sets it and
 * overwrites any value a client sends). Anything that reaches Railway
 * directly is its own connecting address, which can't be faked.
 */
export function getClientIp(req: NextRequest | Request): string {
  const headers = (req as NextRequest).headers ?? new Headers();
  const peer = headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '';
  const viaCloudflare = headers.get('cf-connecting-ip')?.trim() || '';
  if (peer && viaCloudflare && isCloudflareIp(peer)) return viaCloudflare;
  if (peer) return peer;
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real;
  return 'unknown';
}

/**
 * Check whether `key` is over its rate limit.
 *
 * Returns `{ allowed: false, retryAfterMs }` when limited; `{ allowed: true }`
 * otherwise. On allowed checks, the request is recorded against the bucket.
 *
 * @param key   stable identifier (e.g. "signin:1.2.3.4" or "signin:user@x.com")
 * @param limit max hits per window
 * @param windowMs window size in ms
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: true } | { allowed: false; retryAfterMs: number } {
  const now = Date.now();
  const cutoff = now - windowMs;

  let entry = buckets.get(key);
  if (!entry) {
    entry = { hits: [], touchedAt: now };
    buckets.set(key, entry);
  }

  // Drop stale hits outside the sliding window.
  if (entry.hits.length && entry.hits[0] < cutoff) {
    entry.hits = entry.hits.filter((t) => t >= cutoff);
  }

  if (entry.hits.length >= limit) {
    const oldest = entry.hits[0];
    const retryAfterMs = Math.max(0, oldest + windowMs - now);
    return { allowed: false, retryAfterMs };
  }

  entry.hits.push(now);
  entry.touchedAt = now;

  // Evict oldest-touched entries if we're over the cap.
  if (buckets.size > MAX_KEYS) {
    let oldestKey: string | null = null;
    let oldestTouched = Infinity;
    for (const [k, v] of buckets) {
      if (v.touchedAt < oldestTouched) {
        oldestTouched = v.touchedAt;
        oldestKey = k;
      }
    }
    if (oldestKey) buckets.delete(oldestKey);
  }

  return { allowed: true };
}

/**
 * Convenience: check a list of buckets (e.g. per-IP AND per-email) and
 * return the first that's over limit. The check is recorded against ALL
 * provided keys when allowed (so future requests see this hit).
 */
export function rateLimitAny(
  checks: { key: string; limit: number; windowMs: number }[],
): { allowed: true } | { allowed: false; retryAfterMs: number } {
  // First do a read-only pass to find a tripped bucket without recording.
  for (const c of checks) {
    const peek = peekRateLimit(c.key, c.limit, c.windowMs);
    if (!peek.allowed) return peek;
  }
  // All clear — record a hit against each bucket.
  for (const c of checks) rateLimit(c.key, c.limit, c.windowMs);
  return { allowed: true };
}

/** Read-only: would `rateLimit(...)` allow a hit right now? Does not record. */
export function peekRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: true } | { allowed: false; retryAfterMs: number } {
  const now = Date.now();
  const cutoff = now - windowMs;
  const entry = buckets.get(key);
  if (!entry) return { allowed: true };
  const live = entry.hits.filter((t) => t >= cutoff);
  if (live.length >= limit) {
    const retryAfterMs = Math.max(0, live[0] + windowMs - now);
    return { allowed: false, retryAfterMs };
  }
  return { allowed: true };
}

/** Pretty-format ms into "Xs" / "Xm" for user-facing retry-after messages. */
export function formatRetryAfter(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s} second${s === 1 ? '' : 's'}`;
  const m = Math.ceil(s / 60);
  return `${m} minute${m === 1 ? '' : 's'}`;
}
