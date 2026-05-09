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

/** Get the client IP from common proxy headers. */
export function getClientIp(req: NextRequest | Request): string {
  const headers = (req as NextRequest).headers ?? new Headers();
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    // x-forwarded-for: "client, proxy1, proxy2" — first is the real client
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = headers.get('x-real-ip');
  if (real) return real.trim();
  const cf = headers.get('cf-connecting-ip');
  if (cf) return cf.trim();
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
