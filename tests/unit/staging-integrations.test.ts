import { describe, expect, it } from 'vitest';
import { fakeIntegrationFetch, integrationCalls, integrationStandInFor } from '@/lib/staging-integrations';

// The test copy's stand-ins for Tripleseat, Event Temple, Calendly and Google
// Calendar: which calls they take, what they answer, and what they record.
describe('test copy stand-ins for connected services', () => {
  it('answer only those services (other Google APIs pass through)', () => {
    expect(integrationStandInFor(new URL('https://api.tripleseat.com/v1/locations.json'))).toBe('tripleseat');
    expect(integrationStandInFor(new URL('https://api.calendly.com/users/me'))).toBe('calendly');
    expect(integrationStandInFor(new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events'))).toBe('google');
    expect(integrationStandInFor(new URL('https://oauth2.googleapis.com/token'))).toBe('google');
    expect(integrationStandInFor(new URL('https://www.googleapis.com/webfonts/v1/webfonts'))).toBeNull();
    expect(integrationStandInFor(new URL('https://places.googleapis.com/v1/places'))).toBeNull();
    expect(integrationStandInFor(new URL('https://api.stripe.com/v1/charges'))).toBeNull();
  });

  it('refuse a "bad" key and record what was sent', async () => {
    const since = new Date().toISOString();
    expect((await fakeIntegrationFetch('https://api.tripleseat.com/v1/locations.json?public_key=bad-key')).status).toBe(401);
    const res = await fakeIntegrationFetch('https://api.tripleseat.com/v1/leads/create.json?public_key=ts-1', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lead: { first_name: 'Ana' } }),
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { lead_id: number }).lead_id).toBeGreaterThan(0);
    const [last] = integrationCalls({ service: 'tripleseat', since });
    expect(last).toMatchObject({ method: 'POST', path: '/v1/leads/create.json?public_key=ts-1', body: { lead: { first_name: 'Ana' } } });
  });

  it('Calendly hands back a subscription for the address it was given', async () => {
    const res = await fakeIntegrationFetch('https://api.calendly.com/webhook_subscriptions', {
      method: 'POST', headers: { authorization: 'Bearer cal-1' }, body: JSON.stringify({ url: 'https://app.example.com/api/webhooks/calendly' }),
    });
    expect(((await res.json()) as { resource: { uri: string; callback_url: string } }).resource).toMatchObject({ callback_url: 'https://app.example.com/api/webhooks/calendly' });
    expect((await fakeIntegrationFetch('https://api.calendly.com/users/me', { headers: { authorization: 'Bearer bad-token' } })).status).toBe(401);
  });

  it('Google gives a refresh token only for a sign-in code, and refuses a bad one', async () => {
    const token = (body: Record<string, string>) => fakeIntegrationFetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams(body) });
    expect(await (await token({ grant_type: 'authorization_code', code: 'abc' })).json()).toHaveProperty('refresh_token');
    expect(await (await token({ grant_type: 'refresh_token', refresh_token: 'r1' })).json()).not.toHaveProperty('refresh_token');
    expect((await token({ grant_type: 'authorization_code', code: 'bad-code' })).status).toBe(400);
  });
});
