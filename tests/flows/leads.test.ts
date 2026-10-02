import { beforeAll, describe, expect, it } from 'vitest';
import { db, ensureFlowVenue, FLOW_VENUE, outbox, runId, submitListingLead, waitForEmail } from './helpers';

const STORYVENUE_LOGO = 'storyvenue-logo-dark.png';

describe('a bride fills in a venue’s listing form', () => {
  const email = `ava.${runId}@example.com`;
  // Its own test address per run: the form allows 20 submissions per couple an hour.
  const clientIp = `203.0.113.${1 + (parseInt(runId.slice(-4), 36) % 250)}`;
  const form = {
    venue_id: FLOW_VENUE.id, first_name: 'ava', last_name: 'flow', email, phone: '(212) 555-0188',
    guest_count: 120, message: 'Hi! Pricing please.', source: 'directory', client_ip: clientIp,
  };
  let leadId = '';
  let since = '';

  beforeAll(async () => {
    await ensureFlowVenue();
    since = new Date().toISOString();
  });

  it('refuses a submission the directory did not sign, and saves nothing', async () => {
    const forged = { ...form, email: `eve.${runId}@example.com` };
    expect((await submitListingLead(forged, { sign: false })).status).toBe(401);
    const { count } = await db.from('leads').select('id', { count: 'exact', head: true }).eq('email', forged.email);
    expect(count).toBe(0);
  });

  it('asks for the required details', async () => {
    expect((await submitListingLead({ ...form, phone: undefined })).status).toBe(400);
  });

  it('creates the lead in the sales pipeline', async () => {
    const res = await submitListingLead(form);
    expect(res.status).toBe(201);
    leadId = ((await res.json()) as { lead_id: string }).lead_id;
    const { data: lead } = await db.from('leads').select('*').eq('id', leadId).single();
    expect(lead).toMatchObject({
      venue_id: FLOW_VENUE.id, first_name: 'Ava', last_name: 'Flow', email, source: 'directory', guest_count: 120,
      sms_consent: true, sms_dnd: false, marketing_email_opt_in: true, excluded_from_pipeline: false,
    });
    expect(lead.stage_id).toBeTruthy();
  });

  it('saves proof of the texting consent shown on the form', async () => {
    const { data } = await db.from('sms_consent_records').select('source, disclosure_text, ip').eq('lead_id', leadId);
    expect(data?.length).toBe(1);
    expect(data![0]).toMatchObject({ source: 'form_submit', ip: clientIp });
    expect(String(data![0].disclosure_text).length).toBeGreaterThan(20);
  });

  it('sends the bride her pricing guide, branded with the venue, not StoryVenue', async () => {
    const e = await waitForEmail({ to: email, since }, (x) => x.subject === `Your pricing guide from ${FLOW_VENUE.name}`);
    expect(e.html).toContain(`${FLOW_VENUE.name}</p>`);
    expect(e.html).not.toContain(STORYVENUE_LOGO);
  });

  it('alerts the owner once, with the StoryVenue logo', async () => {
    const e = await waitForEmail({ to: FLOW_VENUE.email, since }, (x) => x.subject === `New lead: Ava Flow — ${FLOW_VENUE.name}`);
    expect(e.html).toContain(STORYVENUE_LOGO);
    const alerts = (await outbox({ to: FLOW_VENUE.email, since })).filter((x) => x.subject === e.subject);
    expect(alerts).toHaveLength(1);
  });

  it('a second submission from the same bride makes no duplicate lead', async () => {
    expect((await submitListingLead({ ...form, message: 'Just following up!' })).status).toBe(201);
    const { count } = await db.from('leads').select('id', { count: 'exact', head: true }).eq('venue_id', FLOW_VENUE.id).eq('email', email);
    expect(count).toBe(1);
  });

  it('a double submit sends nothing more: one guide for her, one alert for the owner', async () => {
    await new Promise((r) => setTimeout(r, 4000));
    const toOwner = (await outbox({ to: FLOW_VENUE.email, since })).map((e) => e.subject);
    expect(toOwner.filter((s) => s.startsWith('New lead: Ava Flow'))).toHaveLength(1);
    expect(toOwner.filter((s) => s.startsWith('Ava Flow asked again'))).toHaveLength(0);
    expect((await outbox({ to: email, since })).filter((e) => e.subject === `Your pricing guide from ${FLOW_VENUE.name}`)).toHaveLength(1);
  });

  it('when she asks again later, the owner gets one "asked again" email with her new message', async () => {
    // Her first inquiry was a while ago.
    await db.from('leads').update({ created_at: new Date(Date.now() - 2 * 3_600_000).toISOString() }).eq('id', leadId);
    const again = new Date().toISOString();
    expect((await submitListingLead({ ...form, message: 'Is June 14 still open?' })).status).toBe(201);
    const e = await waitForEmail({ to: FLOW_VENUE.email, since: again }, (x) => x.subject === `Ava Flow asked again — ${FLOW_VENUE.name}`);
    expect(e.html).toContain('Is June 14 still open?');
    expect(e.html).not.toContain('Hi! Pricing please.');
    expect(e.html).toContain(STORYVENUE_LOGO);

    // At most once a day: asking a third time sends nothing more.
    expect((await submitListingLead({ ...form, message: 'Hello?' })).status).toBe(201);
    await new Promise((r) => setTimeout(r, 4000));
    const toOwner = (await outbox({ to: FLOW_VENUE.email, since })).map((x) => x.subject);
    expect(toOwner.filter((s) => s.startsWith('Ava Flow asked again'))).toHaveLength(1);
    expect(toOwner.filter((s) => s.startsWith('New lead: Ava Flow'))).toHaveLength(1);
    const { count } = await db.from('leads').select('id', { count: 'exact', head: true }).eq('venue_id', FLOW_VENUE.id).eq('email', email);
    expect(count).toBe(1);
  });
});
