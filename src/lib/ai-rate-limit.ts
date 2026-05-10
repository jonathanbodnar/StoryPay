/**
 * AI route rate-limiting helpers.
 *
 * Every AI route that calls DeepSeek or OpenAI must call
 * `checkAiRateLimit` before dispatching to the LLM. Two buckets are
 * checked: per-venue (prevents a single tenant burning credits) and
 * per-IP (prevents multi-account / credential-stuffing abuse).
 *
 * Limits are intentionally generous for real usage but tight enough to
 * kill runaway scripts or compromised sessions:
 *
 *   route           per-venue / window     per-IP / window
 *   ─────────────── ─────────────────────  ─────────────────────
 *   chat            20 / min               40 / min
 *   proposal        10 / hour              20 / hour   ← most expensive (3 000 tok)
 *   refine-text     30 / min               60 / min
 *   pricing-guide   25 / min               50 / min
 *   calendar-search 20 / min               40 / min
 *
 * Implementation notes:
 *  - Uses `peekRateLimit` for the read-only check so that a tripping IP
 *    bucket does NOT consume the venue's quota.
 *  - Limits are in-process (see rate-limit.ts caveats). Acceptable for
 *    a single Railway dyno; swap to Redis before horizontal scaling.
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
  peekRateLimit,
  rateLimit,
  getClientIp,
  formatRetryAfter,
} from '@/lib/rate-limit';

// ── Route definitions ──────────────────────────────────────────────────────

export type AiRoute =
  | 'chat'
  | 'proposal'
  | 'refine-text'
  | 'pricing-guide'
  | 'calendar-search';

interface RouteLimits {
  venueLimit:    number;
  venueWindowMs: number;
  ipLimit:       number;
  ipWindowMs:    number;
  /** Human-readable window name used in error messages. */
  windowLabel:   string;
}

const LIMITS: Record<AiRoute, RouteLimits> = {
  'chat':            { venueLimit: 20, venueWindowMs: 60_000,     ipLimit: 40,  ipWindowMs: 60_000,     windowLabel: 'minute'  },
  'proposal':        { venueLimit: 10, venueWindowMs: 3_600_000,  ipLimit: 20,  ipWindowMs: 3_600_000,  windowLabel: 'hour'    },
  'refine-text':     { venueLimit: 30, venueWindowMs: 60_000,     ipLimit: 60,  ipWindowMs: 60_000,     windowLabel: 'minute'  },
  'pricing-guide':   { venueLimit: 25, venueWindowMs: 60_000,     ipLimit: 50,  ipWindowMs: 60_000,     windowLabel: 'minute'  },
  'calendar-search': { venueLimit: 20, venueWindowMs: 60_000,     ipLimit: 40,  ipWindowMs: 60_000,     windowLabel: 'minute'  },
};

// ── Public entry ──────────────────────────────────────────────────────────

/**
 * Check both per-venue and per-IP rate limits for an AI route.
 *
 * Returns a `NextResponse` with status 429 if either limit is exceeded,
 * or `null` if the request is allowed (and the hit is recorded).
 *
 * @param req      Incoming request (used to extract the client IP).
 * @param venueId  The authenticated venue's ID (from session cookie).
 * @param route    Which AI route this is.
 */
export function checkAiRateLimit(
  req: NextRequest,
  venueId: string,
  route: AiRoute,
): NextResponse | null {
  const cfg  = LIMITS[route];
  const ip   = getClientIp(req);

  const venueKey = `ai:${route}:venue:${venueId}`;
  const ipKey    = `ai:${route}:ip:${ip}`;

  // Read-only peek first so a tripping IP doesn't burn the venue bucket.
  const venuePeek = peekRateLimit(venueKey, cfg.venueLimit, cfg.venueWindowMs);
  if (!venuePeek.allowed) {
    return NextResponse.json(
      {
        error: `AI rate limit: you can make ${cfg.venueLimit} requests per ${cfg.windowLabel}. ` +
               `Retry in ${formatRetryAfter(venuePeek.retryAfterMs)}.`,
      },
      { status: 429 },
    );
  }

  if (ip !== 'unknown') {
    const ipPeek = peekRateLimit(ipKey, cfg.ipLimit, cfg.ipWindowMs);
    if (!ipPeek.allowed) {
      return NextResponse.json(
        {
          error: `Too many AI requests from this network. ` +
                 `Retry in ${formatRetryAfter(ipPeek.retryAfterMs)}.`,
        },
        { status: 429 },
      );
    }
  }

  // Both clear — now record the hit.
  rateLimit(venueKey, cfg.venueLimit, cfg.venueWindowMs);
  if (ip !== 'unknown') {
    rateLimit(ipKey, cfg.ipLimit, cfg.ipWindowMs);
  }

  return null;
}

// ── Input sanitisers ─────────────────────────────────────────────────────

/**
 * Truncate a string to `maxChars`. Returns an empty string if `value` is
 * not a string. Never throws.
 */
export function capInputLength(value: unknown, maxChars: number): string {
  if (typeof value !== 'string') return '';
  return value.length <= maxChars ? value : value.slice(0, maxChars);
}
