/**
 * The test copy's stand-ins for the services venues connect their bookings and
 * calendars to: Tripleseat, Event Temple, Calendly and Google Calendar. On the
 * test copy their API calls are answered here (the fetch guard in
 * lib/staging.ts sends them) and recorded, so tests can see exactly what would
 * have been sent (GET /api/staging/integrations). Nothing reaches the real
 * services. A key, token or code starting with "bad" is treated as wrong.
 */

export interface IntegrationCall {
  at: string;
  service: string;
  method: string;
  path: string;
  body: unknown;
}

const SERVICES: Record<string, string> = {
  'api.tripleseat.com': 'tripleseat',
  'api.eventtemple.com': 'eventtemple',
  'api.calendly.com': 'calendly',
  'oauth2.googleapis.com': 'google',
};

/** The stand-in that answers this URL, if any. Only Google's calendar and sign-in calls; other Google APIs pass. */
export function integrationStandInFor(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  if (host === 'www.googleapis.com') {
    return url.pathname.startsWith('/calendar/v3/') || url.pathname.startsWith('/oauth2/') ? 'google' : null;
  }
  return SERVICES[host] ?? null;
}

const MAX_CALLS = 2000;

function calls(): IntegrationCall[] {
  const g = globalThis as typeof globalThis & { __stagingIntegrationCalls?: IntegrationCall[] };
  return (g.__stagingIntegrationCalls ??= []);
}

/** What the stand-ins were sent, newest first. */
export function integrationCalls(filter: { service?: string; since?: string } = {}): IntegrationCall[] {
  return calls().filter((c) => (!filter.service || c.service === filter.service) && (!filter.since || c.at >= filter.since));
}

const json = (status: number, body: unknown) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const isBad = (value: string | null | undefined) => /^bad/i.test((value ?? '').replace(/^Bearer\s+/i, '').trim());

let seq = 1000;

export async function fakeIntegrationFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const req = new Request(input, init);
  const url = new URL(req.url);
  const service = integrationStandInFor(url) ?? 'unknown';
  const text = req.method === 'GET' || req.method === 'HEAD' ? '' : await req.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = Object.fromEntries(new URLSearchParams(text));
    }
  }
  const list = calls();
  list.unshift({ at: new Date().toISOString(), service, method: req.method, path: url.pathname + url.search, body });
  if (list.length > MAX_CALLS) list.length = MAX_CALLS;

  const p = url.pathname;
  const m = req.method;
  const auth = req.headers.get('authorization');

  if (service === 'tripleseat') {
    if (isBad(url.searchParams.get('public_key'))) return json(401, { error: 'Invalid public key' });
    if (m === 'GET' && p === '/v1/locations.json') return json(200, [{ location: { id: 4242, name: 'Test copy location' } }]);
    if (m === 'POST' && p === '/v1/leads/create.json') return json(201, { lead_id: ++seq, success_message: 'Lead created' });
  }

  if (service === 'eventtemple') {
    if (isBad(req.headers.get('x-api-key'))) return json(401, { errors: [{ title: 'Unauthorized' }] });
    if (m === 'GET' && p === '/v2/organizations') return json(200, { data: [{ id: '777', type: 'organizations', attributes: { name: 'Test copy organization' } }] });
    if (m === 'GET' && p === '/v2/referral_sources') return json(200, { data: [{ id: '31', type: 'referral_sources', attributes: { name: 'StoryVenue - Bride Booking System™' } }] });
    if (m === 'GET' && p === '/v2/booking_types') return json(200, { data: [{ id: '41', type: 'booking_types', attributes: { name: 'Wedding' } }] });
    if (m === 'GET' && p === '/v2/pipelines') return json(200, { data: [{ id: '51', type: 'pipelines', attributes: { name: 'Sales' } }] });
    if (m === 'GET' && p === '/v2/stages') {
      return json(200, { data: [{ id: '61', type: 'stages', attributes: { name: 'New lead', pipeline_id: 51 }, relationships: { pipeline: { data: { id: '51' } } } }] });
    }
    if (m === 'POST' && p === '/v2/bookings') return json(201, { data: { id: String(++seq), type: 'bookings' } });
    if (m === 'POST' && p === '/v2/notes') return json(201, { data: { id: String(++seq), type: 'notes' } });
  }

  if (service === 'calendly') {
    if (isBad(auth)) return json(401, { title: 'Unauthenticated', message: 'The access token is invalid' });
    const base = 'https://api.calendly.com';
    if (m === 'GET' && p === '/users/me') {
      return json(200, { resource: { uri: `${base}/users/test-copy-user`, name: 'Test Copy Calendly', email: 'calendly@test-copy.example.com', current_organization: `${base}/organizations/test-copy-org` } });
    }
    if (m === 'POST' && p === '/webhook_subscriptions') {
      const b = (body ?? {}) as { url?: string; organization?: string; events?: string[] };
      return json(201, { resource: { uri: `${base}/webhook_subscriptions/${++seq}`, callback_url: b.url, organization: b.organization, events: b.events, state: 'active' } });
    }
    if (m === 'DELETE' && p.startsWith('/webhook_subscriptions/')) return json(204, null);
    if (m === 'GET' && p === '/scheduled_events') return json(200, { collection: [], pagination: { next_page: null } });
    if (m === 'GET' && /^\/scheduled_events\/[^/]+\/invitees$/.test(p)) return json(200, { collection: [], pagination: { next_page: null } });
  }

  if (service === 'google') {
    if (url.hostname === 'oauth2.googleapis.com' && m === 'POST' && p === '/token') {
      const b = (body ?? {}) as Record<string, string>;
      if (isBad(b.code) || isBad(b.refresh_token)) return json(400, { error: 'invalid_grant' });
      return json(200, {
        access_token: `ya29.test-copy-${++seq}`, expires_in: 3600, token_type: 'Bearer',
        scope: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.email',
        ...(b.grant_type === 'authorization_code' ? { refresh_token: `1//test-copy-refresh-${seq}` } : {}),
      });
    }
    if (isBad(auth)) return json(401, { error: { code: 401, message: 'Invalid Credentials' } });
    if (m === 'GET' && p === '/oauth2/v2/userinfo') return json(200, { email: 'calendar@test-copy.example.com', verified_email: true });
    if (m === 'GET' && p === '/calendar/v3/users/me/calendarList') {
      return json(200, { items: [{ id: 'primary', summary: 'Test copy calendar', primary: true, accessRole: 'owner' }] });
    }
    const event = p.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/);
    if (event) {
      const [, calendarId, eventId] = event;
      if (m === 'POST' && !eventId) {
        const id = `test-copy-event-${++seq}`;
        return json(200, { id, status: 'confirmed', htmlLink: `https://calendar.google.com/calendar/event?eid=${id}`, ...(body as object) });
      }
      if ((m === 'PATCH' || m === 'PUT') && eventId) return json(200, { id: eventId, status: 'confirmed', ...(body as object) });
      if (m === 'DELETE' && eventId) return json(204, null);
      if (m === 'GET' && !eventId) return json(200, { kind: 'calendar#events', summary: decodeURIComponent(calendarId), items: [] });
    }
  }

  return json(404, { error: `The test copy's stand-in for ${service} doesn't know ${m} ${p}` });
}
