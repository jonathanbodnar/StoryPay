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

export async function createWebhook(
  token: string,
  orgUri: string,
  callbackUrl: string
): Promise<string> {
  const res = await calendlyFetch('/webhook_subscriptions', token, {
    method: 'POST',
    body: JSON.stringify({
      url: callbackUrl,
      events: ['invitee.created', 'invitee.canceled'],
      organization: orgUri,
      scope: 'organization',
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
