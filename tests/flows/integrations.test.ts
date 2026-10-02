import { createHmac } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { Browser, db, env, integrationCalls, runId, submitListingLead, waitForIntegrationCall } from './helpers';

// The services venues connect, against the test copy's stand-ins
// (lib/staging-integrations): connecting each one, a wrong key refused, and
// what a new lead or booking sends to it. On a fresh venue, so nothing else
// pushes to them.
describe('connected services', () => {
  const email = `connect.${runId}@example.com`;
  const n = (parseInt(runId.slice(-5), 36) % 9000) + 1000;
  const owner = new Browser();
  let venueId = '';

  const lead = async (first: string, i: number) => {
    const res = await submitListingLead({
      venue_id: venueId, first_name: first, last_name: 'Connected', email: `${first.toLowerCase()}.connect.${runId}@example.com`,
      phone: `(646) 56${4 + i}-${n}`, wedding_date: '2027-09-18', guest_count: 120, source: 'directory', client_ip: `198.51.100.${10 + i}`,
    });
    expect(res.status, await res.clone().text()).toBe(201);
  };

  beforeAll(async () => {
    const res = await owner.fetch('/api/auth/signup', {
      method: 'POST', json: { venue_name: `Connect Barn ${runId}`, first_name: 'Con', last_name: 'Nect', email, phone: '(212) 555-0168', password: `Connect-${runId}-Barn-2027!` },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    venueId = (await db.from('venues').select('id').ilike('email', email).single()).data!.id;
  });

  it('Tripleseat: a wrong key is refused; once connected, a new lead lands there with its details and source', async () => {
    expect((await owner.fetch('/api/integrations/tripleseat', { method: 'POST', json: { publicKey: 'bad-key' } })).status).toBe(400);
    const res = await owner.fetch('/api/integrations/tripleseat', { method: 'POST', json: { publicKey: `ts-${runId}` } });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toMatchObject({ connected: true, locationId: 4242 });

    const since = new Date().toISOString();
    await lead('Tess', 0);
    const call = await waitForIntegrationCall('tripleseat', since, (c) => c.path.startsWith('/v1/leads/create.json'));
    expect(call.path).toContain(`public_key=ts-${runId}`);
    expect((call.body as { lead: Record<string, unknown> }).lead).toMatchObject({
      first_name: 'Tess', last_name: 'Connected', email_address: `tess.connect.${runId}@example.com`, location_id: 4242,
      selected_lead_sources_attributes: [{ lead_source_other: 'StoryVenue - Bride Booking System™' }],
    });

    // Disconnected: the next lead stays home.
    expect((await owner.fetch('/api/integrations/tripleseat', { method: 'DELETE' })).status).toBe(200);
    const after = new Date().toISOString();
    await lead('Theo', 1);
    await new Promise((r) => setTimeout(r, 3000));
    expect((await integrationCalls('tripleseat', after)).filter((c) => c.path.startsWith('/v1/leads/create.json'))).toHaveLength(0);
  });

  it('Event Temple: a wrong key is refused; once connected, a new lead becomes a booking with a note', async () => {
    expect((await owner.fetch('/api/integrations/eventtemple', { method: 'POST', json: { apiKey: 'bad-key', orgId: '777' } })).status).toBe(400);
    const res = await owner.fetch('/api/integrations/eventtemple', { method: 'POST', json: { apiKey: `et-${runId}`, orgId: '777' } });
    expect(res.status, await res.clone().text()).toBe(200);

    const since = new Date().toISOString();
    await lead('Etta', 2);
    const booking = await waitForIntegrationCall('eventtemple', since, (c) => c.method === 'POST' && c.path === '/v2/bookings');
    expect((booking.body as { data: { attributes: Record<string, unknown> } }).data.attributes).toMatchObject({
      status: 'lead', start_date: '2027-09-18', contact: { first_name: 'Etta', last_name: 'Connected', email: `etta.connect.${runId}@example.com` },
    });
    await waitForIntegrationCall('eventtemple', since, (c) => c.method === 'POST' && c.path === '/v2/notes');
    expect((await owner.fetch('/api/integrations/eventtemple', { method: 'DELETE' })).status).toBe(200);
  });

  it('Calendly: connecting registers bookings to come back to this app, signed; a signed booking lands once', async () => {
    expect((await owner.fetch('/api/integrations/calendly/connect', { method: 'POST', json: { access_token: 'bad-token' } })).status).toBe(400);
    const since = new Date().toISOString();
    const res = await owner.fetch('/api/integrations/calendly/connect', { method: 'POST', json: { access_token: `cal-${runId}` } });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toMatchObject({ connected: true, webhook_registered: true });
    const sub = await waitForIntegrationCall('calendly', since, (c) => c.method === 'POST' && c.path === '/webhook_subscriptions');
    const { url, signing_key } = sub.body as { url: string; signing_key: string };
    // Until Oct 2 this read https://undefined/api/webhooks/calendly on Railway.
    expect(url).toBe(`${new URL(env.base).origin}/api/webhooks/calendly`);
    const { data: v } = await db.from('venues').select('calendly_webhook_signing_key, calendly_org_uri').eq('id', venueId).single();
    expect(v!.calendly_webhook_signing_key).toBe(signing_key);

    const start = new Date(Date.now() + 9 * 86_400_000);
    const raw = JSON.stringify({
      event: 'invitee.created',
      payload: {
        email: `cal.connect.${runId}@example.com`, name: 'Cal Connected',
        scheduled_event: { uri: `https://api.calendly.com/scheduled_events/connect-${runId}`, start_time: start.toISOString(), end_time: new Date(start.getTime() + 3_600_000).toISOString(), name: 'Venue Tour', organization: v!.calendly_org_uri },
      },
    });
    const send = (signature: string) => fetch(`${env.base}/api/webhooks/calendly`, {
      method: 'POST', headers: { 'x-staging-key': env.stagingKey, 'content-type': 'application/json', 'calendly-webhook-signature': signature }, body: raw,
    });
    const t = Math.floor(Date.now() / 1000);
    const signature = `t=${t},v1=${createHmac('sha256', signing_key).update(`${t}.${raw}`).digest('hex')}`;
    expect((await send(signature)).status).toBe(200);
    expect((await send(signature)).status).toBe(200);
    const { data: events } = await db.from('calendar_events').select('id').eq('venue_id', venueId).like('notes', `%calendly_event_id:connect-${runId}%`);
    expect(events).toHaveLength(1);

    const off = new Date().toISOString();
    expect((await owner.fetch('/api/integrations/calendly/disconnect', { method: 'POST' })).status).toBeLessThan(300);
    await waitForIntegrationCall('calendly', off, (c) => c.method === 'DELETE' && c.path.startsWith('/webhook_subscriptions/'));
  });

  it('Google Calendar: connecting finishes only for this venue; events are added, moved and removed there', async () => {
    const start = await owner.fetch('/api/calendar/google/connect');
    expect(start.status, await start.clone().text()).toBe(307);
    const google = new URL(start.headers.get('location')!);
    expect(google.hostname).toBe('accounts.google.com');
    const state = google.searchParams.get('state')!;

    // Someone else's browser can't finish it; a forged state is refused.
    const stranger = await new Browser().fetch(`/api/calendar/google/callback?code=test-code&state=${encodeURIComponent(state)}`);
    expect(stranger.headers.get('location')).toContain('/login');
    const forged = await owner.fetch(`/api/calendar/google/callback?code=test-code&state=${encodeURIComponent(venueId)}`);
    expect(forged.headers.get('location')).toContain('error=google_denied');

    const done = await owner.fetch(`/api/calendar/google/callback?code=test-code&state=${encodeURIComponent(state)}`);
    expect(done.headers.get('location')).toContain('connected=1');
    const { data: settings } = await db.from('venue_calendar_settings').select('google_connected, google_account_email').eq('venue_id', venueId).single();
    expect(settings).toMatchObject({ google_connected: true, google_account_email: 'calendar@test-copy.example.com' });

    const since = new Date().toISOString();
    const at = new Date(Date.now() + 12 * 86_400_000);
    const made = await owner.fetch('/api/calendar', {
      method: 'POST', json: { title: `Tasting ${runId}`, event_type: 'tasting', status: 'confirmed', start_at: at.toISOString(), end_at: new Date(at.getTime() + 3_600_000).toISOString() },
    });
    expect(made.status, await made.clone().text()).toBeLessThan(300);
    const insert = await waitForIntegrationCall('google', since, (c) => c.method === 'POST' && c.path.startsWith('/calendar/v3/calendars/primary/events'));
    expect((insert.body as { summary: string }).summary).toBe(`Tasting ${runId}`);
    let row: { id: string; google_event_id: string | null } | null = null;
    for (let i = 0; i < 20 && !row?.google_event_id; i++) {
      row = (await db.from('calendar_events').select('id, google_event_id').eq('venue_id', venueId).eq('title', `Tasting ${runId}`).single()).data;
      if (!row?.google_event_id) await new Promise((r) => setTimeout(r, 500));
    }
    expect(row!.google_event_id).toMatch(/^test-copy-event-/);

    const later = new Date(at.getTime() + 86_400_000);
    const moved = await owner.fetch(`/api/calendar/${row!.id}`, { method: 'PATCH', json: { start_at: later.toISOString(), end_at: new Date(later.getTime() + 3_600_000).toISOString() } });
    expect(moved.status, await moved.clone().text()).toBeLessThan(300);
    await waitForIntegrationCall('google', since, (c) => (c.method === 'PATCH' || c.method === 'PUT') && c.path.includes(`/events/${row!.google_event_id}`));
    expect((await owner.fetch(`/api/calendar/${row!.id}`, { method: 'DELETE' })).status).toBeLessThan(300);
    await waitForIntegrationCall('google', since, (c) => c.method === 'DELETE' && c.path.includes(`/events/${row!.google_event_id}`));
  });
});
