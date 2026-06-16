import { NextRequest, NextResponse } from 'next/server';
import { logError, type ErrorLevel, type ErrorSource } from '@/lib/error-log';
import { getSessionUser } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/log-error — PUBLIC client-side error ingest.
 *
 * Called by ClientErrorLogger (window.onerror / unhandledrejection / failed
 * fetches) and the error.tsx boundaries on EVERY surface, including sub-account
 * (venue) pages and public lead-facing forms. No auth required — but the
 * endpoint resolves the venue + user from the session cookie when present so
 * the error is attributed to the right sub-account, and it is rate-limited +
 * size-capped to prevent abuse.
 *
 * Always returns 204 (even on bad input) so the client never retries or shows
 * an error about the error logger itself.
 */

// Per-IP token bucket — cheap in-memory throttle (resets on deploy).
const hits = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const b = hits.get(ip);
  if (!b || now > b.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  b.count += 1;
  return b.count > MAX_PER_WINDOW;
}

const ALLOWED_LEVELS = new Set<ErrorLevel>(['info', 'warning', 'error', 'critical']);

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('x-real-ip')
      || 'unknown';
    if (rateLimited(ip)) return new NextResponse(null, { status: 204 });

    const body = await req.json().catch(() => null) as null | {
      message?: string;
      stack?: string;
      source?: string;
      category?: string;
      level?: string;
      route?: string;
      httpStatus?: number;
      context?: Record<string, unknown>;
    };
    if (!body || typeof body.message !== 'string' || !body.message.trim()) {
      return new NextResponse(null, { status: 204 });
    }

    // Attribute to the sub-account + user when a venue session cookie exists.
    let venueId: string | null = null;
    let userEmail: string | null = null;
    try {
      const session = await getSessionUser();
      if (session) {
        venueId = session.venueId;
        userEmail = session.memberEmail ?? null;
      }
    } catch { /* anonymous / public page — fine */ }

    const level: ErrorLevel = ALLOWED_LEVELS.has(body.level as ErrorLevel)
      ? (body.level as ErrorLevel)
      : 'error';

    await logError({
      level,
      source:     'client' as ErrorSource,
      category:   (body.category ?? 'browser').toString().slice(0, 120),
      message:    body.message.toString().slice(0, 2000),
      // Pass the client stack through as an Error so it's stored in `stack`.
      error:      body.stack ? Object.assign(new Error(body.message), { stack: body.stack }) : undefined,
      venueId,
      userEmail,
      route:      body.route ? body.route.toString().slice(0, 500) : null,
      httpStatus: typeof body.httpStatus === 'number' ? body.httpStatus : null,
      context: {
        ...(body.context ?? {}),
        userAgent: req.headers.get('user-agent') ?? undefined,
      },
    });

    return new NextResponse(null, { status: 204 });
  } catch {
    // Never surface logger failures to the client.
    return new NextResponse(null, { status: 204 });
  }
}
