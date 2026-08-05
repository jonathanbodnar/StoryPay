import { createHmac, timingSafeEqual } from 'node:crypto';

const CALENDLY_BASE = 'https://api.calendly.com';

export interface CalendlyUser {
  uri: string;
  name: string;
  email: string;
  current_organization: string;
}

export interface CalendlyEvent {
  uri: string;
  name: string;
  status: string;             // 'active' | 'canceled'
  start_time: string;         // ISO
  end_time: string;           // ISO
  event_type: string;         // event type URI
  location?: { type: string; location?: string };
  invitees_counter: { total: number };
}

export interface CalendlyInvitee {
  uri: string;
  email: string;
  name: string;
  status: string;             // 'active' | 'canceled'
  cancel_url?: string;
  reschedule_url?: string;
}

async function calendlyFetch(
  path: string,
  token: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = path.startsWith('http') ? path : `${CALENDLY_BASE}${path}`;
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
}

export async function getCalendlyUser(token: string): Promise<CalendlyUser> {
  const res = await calendlyFetch('/users/me', token);
  if (!res.ok) throw new Error(`Calendly /users/me failed: ${res.status}`);
  const { resource } = await res.json();
  return resource;
}

export async function listScheduledEvents(
  token: string,
  orgUri: string,
  options: { from?: string; to?: string; count?: number } = {}
): Promise<CalendlyEvent[]> {
  const params = new URLSearchParams({
    organization: orgUri,
    status: 'active',
    count: String(options.count ?? 100),
    sort: 'start_time:asc',
  });
  if (options.from) params.set('min_start_time', options.from);
  if (options.to)   params.set('max_start_time', options.to);

  const res = await calendlyFetch(`/scheduled_events?${params}`, token);
  if (!res.ok) throw new Error(`Calendly /scheduled_events failed: ${res.status}`);
  const { collection } = await res.json();
  return collection ?? [];
}

export async function getEventInvitees(
  token: string,
  eventUri: string
): Promise<CalendlyInvitee[]> {
  const eventId = eventUri.split('/').pop();
  const res = await calendlyFetch(`/scheduled_events/${eventId}/invitees`, token);
  if (!res.ok) return [];
  const { collection } = await res.json();
  return collection ?? [];
}

/**
 * Creates a Calendly webhook subscription.
 *
 * `signingKey` is generated and supplied BY US (Calendly does not generate or
 * return one — confirmed via Calendly's OpenAPI schema and their own support
 * team: "We don't send the signing key with each webhook payload... you'll
 * need to do this same computation on your end", community.calendly.com,
 * thread "Why does the webhook callback signing key change with every call").
 * Calendly stores whatever key we pass here and uses it to sign every future
 * delivery to this subscription in the `Calendly-Webhook-Signature` header
 * (HMAC-SHA256). Callers MUST persist `signingKey` themselves — Calendly
 * never echoes it back in any response, so if you don't store what you sent,
 * you can't verify deliveries later (you'd need to delete + recreate the
 * subscription with a new key).
 */
export async function createWebhook(
  token: string,
  orgUri: string,
  callbackUrl: string,
  signingKey: string
): Promise<string> {
  const res = await calendlyFetch('/webhook_subscriptions', token, {
    method: 'POST',
    body: JSON.stringify({
      url: callbackUrl,
      events: ['invitee.created', 'invitee.canceled'],
      organization: orgUri,
      scope: 'organization',
      signing_key: signingKey,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Calendly webhook create failed (${res.status}): ${body}`);
  }
  const { resource } = await res.json();
  return resource.uri as string;
}

export async function deleteWebhook(token: string, webhookUri: string): Promise<void> {
  const webhookId = webhookUri.split('/').pop();
  await calendlyFetch(`/webhook_subscriptions/${webhookId}`, token, { method: 'DELETE' });
}

export interface CalendlySignatureResult {
  valid: boolean;
  reason?: 'missing_header' | 'malformed_header' | 'bad_signature' | 'stale_timestamp';
}

/**
 * Verifies the `Calendly-Webhook-Signature` header per Calendly's documented
 * scheme (same shape as Stripe): header is `t=<unix_seconds>,v1=<hex hmac>`,
 * and the signed content is `${t}.${rawBody}` (raw JSON text, not re-serialized).
 * `signingKey` must be exactly what was passed to `createWebhook` for this
 * subscription — Calendly never generates or returns one on its own.
 */
export function verifyCalendlySignature(
  rawBody: string,
  headerValue: string | null,
  signingKey: string,
  maxAgeSeconds = 5 * 60
): CalendlySignatureResult {
  if (!headerValue) return { valid: false, reason: 'missing_header' };

  const parts = Object.fromEntries(
    headerValue.split(',').map((p) => {
      const [k, v] = p.split('=');
      return [k?.trim(), v?.trim()];
    })
  );
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return { valid: false, reason: 'malformed_header' };

  const tsSeconds = Number(t);
  if (!Number.isFinite(tsSeconds)) return { valid: false, reason: 'malformed_header' };
  if (Math.abs(Date.now() / 1000 - tsSeconds) > maxAgeSeconds) {
    return { valid: false, reason: 'stale_timestamp' };
  }

  const expected = createHmac('sha256', signingKey)
    .update(`${t}.${rawBody}`)
    .digest('hex');

  const expectedBuf = Buffer.from(expected, 'hex');
  const actualBuf = Buffer.from(v1, 'hex');
  const isValid =
    expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);

  return isValid ? { valid: true } : { valid: false, reason: 'bad_signature' };
}

/**
 * Map a Calendly event type name to a calendar_event_type enum value.
 * Calendly event names are free-form, so we do a best-effort keyword match.
 */
export function mapEventType(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('tour') || lower.includes('visit') || lower.includes('walkthrough')) return 'tour';
  if (lower.includes('wedding')) return 'wedding';
  if (lower.includes('tasting') || lower.includes('taste')) return 'tasting';
  if (lower.includes('rehearsal')) return 'rehearsal';
  if (lower.includes('reception')) return 'reception';
  if (lower.includes('phone call') || lower.includes('phone-call') || lower.includes('call with')) return 'phone_call';
  if (lower.includes('meeting') || lower.includes('consult') || lower.includes('call')) return 'meeting';
  return 'tour'; // default for Calendly bookings is usually a tour
}
