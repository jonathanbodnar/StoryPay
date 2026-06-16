/**
 * Shared API error-response helper that ALSO logs to the error_logs table.
 *
 * Replaces the inline `NextResponse.json({ error }, { status })` pattern in
 * route handlers so that every failure is both returned to the caller AND
 * captured for the super-admin Error Log — in one call.
 *
 * Usage in a route handler:
 *
 *   import { jsonError } from '@/lib/api-error';
 *   try {
 *     ...
 *   } catch (err) {
 *     return jsonError(err, { route: '/api/foo', source: 'api', venueId });
 *   }
 *
 * Logging is best-effort and never blocks the response.
 */

import { NextResponse } from 'next/server';
import { logError, type ErrorLevel, type ErrorSource } from '@/lib/error-log';

export interface JsonErrorOpts {
  /** HTTP status to return. Defaults to 500. */
  status?: number;
  /** Override the message returned to the client + logged. */
  message?: string;
  route?: string | null;
  method?: string | null;
  source?: ErrorSource;
  category?: string | null;
  level?: ErrorLevel;
  venueId?: string | null;
  userEmail?: string | null;
  context?: Record<string, unknown> | null;
}

export function jsonError(error: unknown, opts: JsonErrorOpts = {}): NextResponse {
  const status = opts.status ?? 500;
  const message = opts.message
    ?? (error instanceof Error ? error.message : String(error));

  // 5xx → error, 4xx → warning (client mistakes), unless explicitly overridden.
  const level: ErrorLevel = opts.level ?? (status >= 500 ? 'error' : 'warning');

  // Fire-and-forget; do not await so the response isn't delayed.
  void logError({
    level,
    source:     opts.source ?? 'api',
    category:   opts.category ?? null,
    message,
    error,
    venueId:    opts.venueId ?? null,
    userEmail:  opts.userEmail ?? null,
    route:      opts.route ?? null,
    method:     opts.method ?? null,
    httpStatus: status,
    context:    opts.context ?? null,
  });

  return NextResponse.json({ error: message }, { status });
}
