/**
 * Centralized error / issue logger.
 *
 * `logError()` is the single entry point used across the platform (API routes,
 * integration libs, cron jobs) to record a failure into `public.error_logs`,
 * which powers the super-admin Error Log tab.
 *
 * Design philosophy (mirrors workflow-execution-logs.ts):
 *   - BEST-EFFORT: every write is wrapped in try/catch and NEVER throws, so a
 *     logging failure can never break the underlying user request.
 *   - PII-SAFE: context payloads are deep-redacted before storage.
 *   - DEDUPED: identical errors (same fingerprint) seen within a short window
 *     bump an occurrence_count instead of flooding the table.
 *   - LIVE: each log fires a realtime broadcast so the admin feed updates
 *     without a refresh, and `critical` errors also email the super admin.
 */

import { createHash } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';

export type ErrorLevel = 'info' | 'warning' | 'error' | 'critical';
export type ErrorSource =
  | 'api' | 'client' | 'sms' | 'email' | 'payment'
  | 'webhook' | 'ai' | 'cron' | 'other';

export interface LogErrorInput {
  /** Severity. Defaults to 'error'. 'critical' also emails the super admin. */
  level?: ErrorLevel;
  /** Origin surface. Defaults to 'other'. */
  source?: ErrorSource;
  /** Finer bucket, e.g. 'ghl_sms_send', 'lunarpay_charge', 'inbound_email'. */
  category?: string | null;
  /** Short human-readable summary. If `error` is given and message is omitted,
   *  the error's message is used. */
  message?: string;
  /** The thrown error (or anything) — its message/stack are extracted. */
  error?: unknown;
  /** Sub-account this belongs to (nullable for platform-level errors). */
  venueId?: string | null;
  /** Who hit it, when known. */
  userEmail?: string | null;
  /** Page path or API endpoint. */
  route?: string | null;
  method?: string | null;
  httpStatus?: number | null;
  /** Arbitrary structured context — deep PII-redacted before storage. */
  context?: Record<string, unknown> | null;
}

// ─── PII redaction ───────────────────────────────────────────────────────────

const SENSITIVE_KEY = /pass(word)?|secret|token|auth|api[_-]?key|cookie|ssn|card|cvv|cvc|account[_-]?number|routing|pin\b|otp|bearer/i;
const PII_KEY       = /email|phone|first[_-]?name|last[_-]?name|full[_-]?name|address|dob|birth|amount|price|nameholder/i;

function redactValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEY.test(key)) return '<redacted>';
  if (PII_KEY.test(key)) {
    if (typeof value === 'string' && value.includes('@')) {
      // Partial-mask emails so they're still useful for matching.
      const [u, d] = value.split('@');
      return `${u.slice(0, 2)}***@${d ?? ''}`;
    }
    return '<redacted>';
  }
  return value;
}

function deepRedact(input: unknown, depth = 0): unknown {
  if (depth > 6 || input == null) return input;
  if (Array.isArray(input)) return input.slice(0, 50).map((v) => deepRedact(v, depth + 1));
  if (typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      const masked = redactValue(k, v);
      out[k] = masked === v ? deepRedact(v, depth + 1) : masked;
    }
    return out;
  }
  if (typeof input === 'string' && input.length > 4000) return `${input.slice(0, 4000)}…[truncated]`;
  return input;
}

// ─── Fingerprinting (for grouping duplicate errors) ──────────────────────────

/** Normalize a message so dynamic bits (ids, numbers, uuids) don't fragment
 *  the fingerprint — "user 123 not found" and "user 456 not found" group. */
function normalizeForFingerprint(msg: string): string {
  return msg
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\b\d+\b/g, '<n>')
    .slice(0, 300)
    .trim()
    .toLowerCase();
}

function computeFingerprint(source: string, category: string | null, message: string, route: string | null): string {
  const basis = `${source}|${category ?? ''}|${route ?? ''}|${normalizeForFingerprint(message)}`;
  return createHash('sha1').update(basis).digest('hex').slice(0, 32);
}

// ─── Critical-error email alert throttle (in-memory, per process) ────────────

const lastAlertAt = new Map<string, number>();
const ALERT_THROTTLE_MS = 60 * 60 * 1000; // 1 hour per fingerprint

function errorMessageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

function errorStackOf(error: unknown): string | null {
  if (error instanceof Error && error.stack) return error.stack.slice(0, 8000);
  return null;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Record an error. Best-effort: never throws. Returns the row id when a write
 * happened (useful in tests), or null when logging was skipped/failed.
 */
export async function logError(input: LogErrorInput): Promise<string | null> {
  try {
    const level: ErrorLevel  = input.level ?? 'error';
    const source: ErrorSource = input.source ?? 'other';
    const category = input.category ?? null;
    const message  = (input.message ?? errorMessageOf(input.error) ?? 'Unknown error')
      .toString()
      .slice(0, 2000);
    const stack    = errorStackOf(input.error);
    const route    = input.route ?? null;
    const fingerprint = computeFingerprint(source, category, message, route);
    const nowIso   = new Date().toISOString();
    const context  = input.context ? (deepRedact(input.context) as Record<string, unknown>) : null;

    // Dedup: if an OPEN (new/investigating) row with the same fingerprint was
    // seen in the last 10 minutes, bump it instead of inserting a new row.
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    let rowId: string | null = null;
    let deduped = false;

    const { data: existing } = await supabaseAdmin
      .from('error_logs')
      .select('id, occurrence_count')
      .eq('fingerprint', fingerprint)
      .in('status', ['new', 'investigating'])
      .gte('last_seen_at', tenMinAgo)
      .order('last_seen_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      deduped = true;
      rowId = existing.id as string;
      await supabaseAdmin
        .from('error_logs')
        .update({
          occurrence_count: ((existing.occurrence_count as number) ?? 1) + 1,
          last_seen_at:     nowIso,
          // Refresh message/context to the latest occurrence for context.
          message,
          context,
        })
        .eq('id', rowId);
    } else {
      const { data: inserted } = await supabaseAdmin
        .from('error_logs')
        .insert({
          level,
          source,
          category,
          message,
          stack,
          venue_id:     input.venueId ?? null,
          user_email:   input.userEmail ?? null,
          route,
          method:       input.method ?? null,
          http_status:  input.httpStatus ?? null,
          context,
          fingerprint,
          occurrence_count: 1,
          status:       'new',
          created_at:   nowIso,
          last_seen_at: nowIso,
        })
        .select('id')
        .single();
      rowId = (inserted?.id as string) ?? null;
    }

    // Fire-and-forget realtime broadcast so the admin feed/badge updates live.
    if (rowId) {
      void (async () => {
        try {
          const { broadcastErrorLogged } = await import('@/lib/realtime/broadcast');
          await broadcastErrorLogged({
            id: rowId!,
            level,
            source,
            category,
            message,
            venueId: input.venueId ?? null,
            deduped,
            createdAt: nowIso,
          });
        } catch { /* non-critical */ }
      })();
    }

    // Critical errors also email the super admin (throttled per fingerprint).
    if (level === 'critical') {
      const last = lastAlertAt.get(fingerprint) ?? 0;
      if (Date.now() - last > ALERT_THROTTLE_MS) {
        lastAlertAt.set(fingerprint, Date.now());
        void sendCriticalAlert({ message, source, category, route, venueId: input.venueId ?? null, stack });
      }
    }

    return rowId;
  } catch (e) {
    console.error('[error-log] logError failed (non-fatal):', e);
    return null;
  }
}

async function sendCriticalAlert(opts: {
  message: string;
  source: string;
  category: string | null;
  route: string | null;
  venueId: string | null;
  stack: string | null;
}): Promise<void> {
  try {
    const to = process.env.ERROR_ALERT_EMAIL?.trim() || process.env.ADMIN_EMAIL?.trim();
    if (!to) return;
    const { sendEmail } = await import('@/lib/email');
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com').replace(/\/+$/, '');
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    await sendEmail({
      to,
      subject: `🚨 Critical error: ${opts.message.slice(0, 80)}`,
      html: `
        <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px">
          <h2 style="color:#b91c1c;margin:0 0 12px">Critical error logged</h2>
          <table style="font-size:14px;border-collapse:collapse">
            <tr><td style="padding:4px 12px 4px 0;color:#666">Message</td><td><strong>${esc(opts.message)}</strong></td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#666">Source</td><td>${esc(opts.source)}${opts.category ? ` · ${esc(opts.category)}` : ''}</td></tr>
            ${opts.route ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Route</td><td>${esc(opts.route)}</td></tr>` : ''}
            ${opts.venueId ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Venue</td><td>${esc(opts.venueId)}</td></tr>` : ''}
          </table>
          ${opts.stack ? `<pre style="background:#f5f5f5;padding:12px;border-radius:8px;font-size:12px;overflow:auto;white-space:pre-wrap">${esc(opts.stack.slice(0, 1500))}</pre>` : ''}
          <p style="margin-top:16px"><a href="${appUrl}/admin/errors" style="color:#1b1b1b;font-weight:600">Open the Error Log →</a></p>
        </div>`,
    });
  } catch (e) {
    console.error('[error-log] critical alert email failed (non-fatal):', e);
  }
}
