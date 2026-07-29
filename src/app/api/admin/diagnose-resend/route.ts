import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface DiagnoseResult {
  healthy: boolean;
  checks: {
    resend_api_key_set: boolean;
    resend_api_key_format_valid: boolean;
    resend_default_from_set: boolean;
    app_url_set: boolean;
    app_url_correct: boolean;
    resend_key_authenticates: boolean | null;
  };
  values: {
    resend_default_from: string | null;
    app_url: string | null;
    resend_api_key_prefix: string | null;
  };
  resend_http_status: number | null;
  resend_http_error: string | null;
  issues: string[];
}

/**
 * GET /api/admin/diagnose-resend
 *
 * Checks all email-related environment variables and makes a live test call
 * to the Resend API to verify authentication. Returns a structured JSON
 * object describing the health of the email configuration.
 *
 * Fields in the response:
 *   healthy               — true only if ALL checks pass
 *   checks.resend_api_key_set         — RESEND_API_KEY env var is present and non-empty
 *   checks.resend_api_key_format_valid — key starts with "re_" (Resend key format)
 *   checks.resend_default_from_set    — RESEND_DEFAULT_FROM env var is set
 *   checks.app_url_set                — NEXT_PUBLIC_APP_URL env var is set
 *   checks.app_url_correct            — NEXT_PUBLIC_APP_URL equals https://app.storyvenue.com
 *   checks.resend_key_authenticates   — live GET /emails returned 200 (null if key missing)
 *   values.resend_default_from        — the actual from address (redacted if missing)
 *   values.app_url                    — the actual app URL value
 *   values.resend_api_key_prefix      — first 6 chars of the key so you can verify it (e.g. "re_abc")
 *   resend_http_status                — HTTP status returned by Resend API (null if skipped)
 *   resend_http_error                 — Error message from Resend if the call failed
 *   issues                            — Human-readable list of detected problems
 */
export async function GET() {
  const apiKey = process.env.RESEND_API_KEY ?? '';
  const defaultFrom = process.env.RESEND_DEFAULT_FROM ?? '';
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';

  const issues: string[] = [];

  const resend_api_key_set = apiKey.length > 0;
  const resend_api_key_format_valid = apiKey.startsWith('re_');
  const resend_default_from_set = defaultFrom.length > 0;
  const app_url_set = appUrl.length > 0;
  const app_url_correct = appUrl === 'https://app.storyvenue.com';

  if (!resend_api_key_set) issues.push('RESEND_API_KEY is not set');
  if (resend_api_key_set && !resend_api_key_format_valid) issues.push('RESEND_API_KEY does not start with "re_" — may be invalid');
  if (!resend_default_from_set) issues.push('RESEND_DEFAULT_FROM is not set');
  if (!app_url_set) issues.push('NEXT_PUBLIC_APP_URL is not set');
  if (app_url_set && !app_url_correct) issues.push(`NEXT_PUBLIC_APP_URL is "${appUrl}" but expected "https://app.storyvenue.com"`);

  let resend_key_authenticates: boolean | null = null;
  let resend_http_status: number | null = null;
  let resend_http_error: string | null = null;

  if (resend_api_key_set) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });
      resend_http_status = res.status;

      if (res.status === 401) {
        resend_key_authenticates = false;
        issues.push('Resend API key is rejected (401 Unauthorized) — key may be revoked or wrong');
      } else if (res.status === 403) {
        resend_key_authenticates = false;
        issues.push('Resend API key returned 403 Forbidden — check key permissions');
      } else if (res.status >= 200 && res.status < 300) {
        resend_key_authenticates = true;
      } else {
        resend_key_authenticates = false;
        const body = await res.text().catch(() => '');
        resend_http_error = body.slice(0, 300) || `HTTP ${res.status}`;
        issues.push(`Resend API returned unexpected status ${res.status}`);
      }
    } catch (err) {
      resend_key_authenticates = false;
      resend_http_error = err instanceof Error ? err.message : String(err);
      issues.push(`Failed to reach Resend API: ${resend_http_error}`);
    }
  }

  const healthy =
    resend_api_key_set &&
    resend_api_key_format_valid &&
    resend_default_from_set &&
    app_url_set &&
    app_url_correct &&
    resend_key_authenticates === true;

  const result: DiagnoseResult = {
    healthy,
    checks: {
      resend_api_key_set,
      resend_api_key_format_valid,
      resend_default_from_set,
      app_url_set,
      app_url_correct,
      resend_key_authenticates,
    },
    values: {
      resend_default_from: resend_default_from_set ? defaultFrom : null,
      app_url: app_url_set ? appUrl : null,
      resend_api_key_prefix: resend_api_key_set ? apiKey.slice(0, 6) : null,
    },
    resend_http_status,
    resend_http_error,
    issues,
  };

  return NextResponse.json(result, { status: healthy ? 200 : 500 });
}
