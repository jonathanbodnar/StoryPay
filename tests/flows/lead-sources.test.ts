import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Browser, db, env, FLOW_VENUE, runId, signedInOwner, waitForEmail } from './helpers';

// Every other door a couple (or a venue's other tools) comes in through:
// the embeddable form on a venue's own website, trigger links in emails,
// the public API the Zapier app uses, a Calendly booking, the pricing guide
// PDF, and the waitlist. (The listing form and website forms have their own
// tests.)
describe('other ways leads come in', () => {
  let owner: Browser;
  let since = '';

  beforeAll(async () => {
    owner = await signedInOwner();
    since = new Date().toISOString();
  });

  it('the embeddable form on a venue’s own website makes a lead and tells the owner', async () => {
    const email = `embed.${runId}@example.com`;
    const res = await fetch(`${env.base}/api/public/embed-leads`, {
      method: 'POST',
      headers: { 'x-staging-key': env.stagingKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        venue_id: FLOW_VENUE.id, first_name: 'Elle', last_name: 'Embed', email, phone: '(212) 555-0171',
        guest_count: 60, message: 'Saw you on your website!', source: 'embed',
      }),
    });
    expect(res.status, await res.clone().text()).toBeLessThan(300);
    const { data } = await db.from('leads').select('id').eq('venue_id', FLOW_VENUE.id).eq('email', email);
    expect(data).toHaveLength(1);
    await waitForEmail({ to: FLOW_VENUE.email, since }, (e) => e.subject.startsWith('New lead: Elle Embed'));
  });

  it('a trigger link in an email records the click and sends the couple on', async () => {
    const created = await owner.fetch('/api/marketing/trigger-links', {
      method: 'POST', json: { name: `Tour page ${runId}`, targetUrl: 'https://example.com/tour' },
    });
    expect(created.status, await created.clone().text()).toBeLessThan(300);
    const { link } = (await created.json()) as { link: { short_code: string } };
    const { data: lead } = await db.from('leads').select('id').eq('venue_id', FLOW_VENUE.id).limit(1).single();
    const click = await fetch(`${env.base}/t/${link.short_code}?l=${lead!.id}`, { headers: { 'x-staging-key': env.stagingKey }, redirect: 'manual' });
    expect(click.status).toBeGreaterThanOrEqual(300);
    expect(click.headers.get('location')).toContain('example.com/tour');
    const { data: events } = await db.from('lead_marketing_events').select('id').eq('lead_id', lead!.id).eq('event_type', 'trigger_link_click').gte('created_at', since);
    expect(events!.length).toBeGreaterThan(0);
    const unknown = await fetch(`${env.base}/t/not-a-real-code`, { headers: { 'x-staging-key': env.stagingKey }, redirect: 'manual' });
    expect(unknown.status).toBe(404);
  });

  it('the public API (Zapier) makes leads with a venue key, and a revoked key stops working', async () => {
    const made = await owner.fetch('/api/integrations/api-keys', { method: 'POST', json: { name: `Zapier ${runId}` } });
    expect(made.status, await made.clone().text()).toBeLessThan(300);
    const { plaintext, key } = (await made.json()) as { plaintext: string; key: { id: string } };
    const api = (path: string, init: RequestInit = {}, token = plaintext) => fetch(`${env.base}${path}`, {
      ...init, headers: { 'x-staging-key': env.stagingKey, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    });
    const me = await api('/api/v1/me');
    expect(me.status).toBe(200);
    expect(JSON.stringify(await me.json())).toContain(FLOW_VENUE.id);
    const email = `zapier.${runId}@example.com`;
    const lead = await api('/api/v1/leads', { method: 'POST', body: JSON.stringify({ first_name: 'Zoe', last_name: 'Zapier', email, phone: '(212) 555-0172' }) });
    expect(lead.status, await lead.clone().text()).toBeLessThan(300);
    const { data } = await db.from('leads').select('id').eq('venue_id', FLOW_VENUE.id).eq('email', email);
    expect(data).toHaveLength(1);
    expect((await api('/api/v1/me', {}, 'sv_live_not-a-real-key')).status).toBe(401);
    expect((await owner.fetch(`/api/integrations/api-keys/${key.id}`, { method: 'DELETE' })).status).toBeLessThan(300);
    expect((await api('/api/v1/me')).status).toBe(401);
  });

  describe('a Calendly booking', () => {
    const orgUri = `https://api.calendly.com/organizations/flow-${runId}`;
    beforeAll(async () => {
      await db.from('venues').update({ calendly_connected: true, calendly_org_uri: orgUri, calendly_webhook_signing_key: null }).eq('id', FLOW_VENUE.id);
    });
    afterAll(async () => {
      await db.from('venues').update({ calendly_connected: false, calendly_org_uri: null }).eq('id', FLOW_VENUE.id);
    });

    it('lands on the venue’s calendar once, however often Calendly sends it', async () => {
      const eventId = `flow-${runId}`;
      const start = new Date(Date.now() + 7 * 86_400_000);
      const payload = {
        event: 'invitee.created',
        payload: {
          email: `calendly.${runId}@example.com`, name: 'Cal Endly',
          scheduled_event: { uri: `https://api.calendly.com/scheduled_events/${eventId}`, start_time: start.toISOString(), end_time: new Date(start.getTime() + 3_600_000).toISOString(), name: 'Venue Tour', organization: orgUri },
        },
      };
      const send = () => fetch(`${env.base}/api/webhooks/calendly`, {
        method: 'POST', headers: { 'x-staging-key': env.stagingKey, 'content-type': 'application/json' }, body: JSON.stringify(payload),
      });
      expect((await send()).status).toBe(200);
      expect((await send()).status).toBe(200);
      const { data } = await db.from('calendar_events').select('id').eq('venue_id', FLOW_VENUE.id).like('notes', `%calendly_event_id:${eventId}%`);
      expect(data).toHaveLength(1);
    });
  });

  it('the owner downloads the pricing guide as a PDF', async () => {
    const res = await owner.fetch('/api/listing/pricing-guide/download');
    expect(res.status, res.status >= 400 ? await res.clone().text() : '').toBe(200);
    expect(res.headers.get('content-type')).toContain('pdf');
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(5_000);
  });

  it('someone joins the waitlist', async () => {
    const before = ((await (await fetch(`${env.base}/api/waitlist`, { headers: { 'x-staging-key': env.stagingKey } })).json()) as { count: number }).count;
    const res = await fetch(`${env.base}/api/waitlist`, {
      method: 'POST', headers: { 'x-staging-key': env.stagingKey, 'content-type': 'application/json' }, body: JSON.stringify({ email: `waitlist.${runId}@example.com`, first_name: 'Wendy', last_name: 'Waitlist', venue_name: `Waitlist Barn ${runId}` }),
    });
    expect(res.status, await res.clone().text()).toBeLessThan(300);
    const after = ((await (await fetch(`${env.base}/api/waitlist`, { headers: { 'x-staging-key': env.stagingKey } })).json()) as { count: number }).count;
    expect(after).toBe(before + 1);
  });
});
