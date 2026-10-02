import { beforeAll, describe, expect, it } from 'vitest';
import { Browser, db, FLOW_VENUE, outbox, runId, runJob, signedInOwner, submitListingLead, waitForEmail } from './helpers';

// The automation builder: most of its triggers are a tag being added (the
// system tags behind "appointment booked", "proposal signed" and the rest). A
// venue's own automation starts when the tag lands on a lead, sends its email
// once, and stops when the automation is paused.
describe('a tag-triggered automation', () => {
  const n = (parseInt(runId.slice(-5), 36) % 9000) + 1000;
  let owner: Browser;
  let tagId = '';
  let automationId = '';

  async function newLead(first: string, i: number): Promise<string> {
    const res = await submitListingLead({
      venue_id: FLOW_VENUE.id, first_name: first, last_name: 'Automated', email: `${first.toLowerCase()}.auto.${runId}@example.com`,
      phone: `(332) 57${i}-${n}`, source: 'directory', client_ip: `198.51.100.${40 + i}`,
    });
    expect(res.status, await res.clone().text()).toBe(201);
    return ((await res.json()) as { lead_id: string }).lead_id;
  }
  const tag = (leadId: string) => owner.fetch(`/api/leads/${leadId}`, { method: 'PATCH', json: { tagIds: [tagId] } });

  beforeAll(async () => {
    owner = await signedInOwner();
    const t = await owner.fetch('/api/marketing/tags', { method: 'POST', json: { name: `Tour ready ${runId}` } });
    expect(t.status, await t.clone().text()).toBeLessThan(300);
    tagId = ((await db.from('marketing_tags').select('id').eq('venue_id', FLOW_VENUE.id).eq('name', `Tour ready ${runId}`).single()).data!).id;
    const a = await owner.fetch('/api/marketing/automations', {
      method: 'POST',
      json: {
        name: `Tour invite ${runId}`, triggerType: 'tag_added', triggerConfig: { tag_ids: [tagId] },
        steps: [{ step_order: 0, step_type: 'send_email', config: { mode: 'quick', subject: `Pick your tour time ${runId}`, body: 'Hi {{contact.first_name}}, choose a time that suits you.' } }],
      },
    });
    expect(a.status, await a.clone().text()).toBeLessThan(300);
    automationId = ((await db.from('marketing_automations').select('id').eq('venue_id', FLOW_VENUE.id).eq('name', `Tour invite ${runId}`).single()).data!).id;
    expect((await owner.fetch(`/api/marketing/automations/${automationId}`, { method: 'PATCH', json: { status: 'active' } })).status).toBeLessThan(300);
  });

  it('the tag lands, the email goes out once, with the couple’s name', async () => {
    const leadId = await newLead('Ainsley', 1);
    const since = new Date().toISOString();
    expect((await tag(leadId)).status).toBeLessThan(300);
    for (let i = 0; i < 2; i++) expect((await runJob('marketing-email')).status).toBe(200);
    const mail = await waitForEmail({ to: `ainsley.auto.${runId}@example.com`, since }, (e) => e.subject === `Pick your tour time ${runId}`);
    expect(mail.html).toContain('Hi Ainsley');
    // Tagged again: no second enrollment, no second email.
    expect((await tag(leadId)).status).toBeLessThan(300);
    for (let i = 0; i < 2; i++) expect((await runJob('marketing-email')).status).toBe(200);
    const { data: enrollments } = await db.from('marketing_automation_enrollments').select('id').eq('automation_id', automationId).eq('lead_id', leadId);
    expect(enrollments).toHaveLength(1);
    expect((await outbox({ to: `ainsley.auto.${runId}@example.com`, since })).filter((e) => e.subject === `Pick your tour time ${runId}`)).toHaveLength(1);
  });

  it('paused, it starts nobody new', async () => {
    expect((await owner.fetch(`/api/marketing/automations/${automationId}`, { method: 'PATCH', json: { status: 'paused' } })).status).toBeLessThan(300);
    const leadId = await newLead('Blair', 2);
    const since = new Date().toISOString();
    expect((await tag(leadId)).status).toBeLessThan(300);
    for (let i = 0; i < 2; i++) expect((await runJob('marketing-email')).status).toBe(200);
    await new Promise((r) => setTimeout(r, 2000));
    expect((await outbox({ to: `blair.auto.${runId}@example.com`, since })).filter((e) => e.subject === `Pick your tour time ${runId}`)).toHaveLength(0);
    // Tidy up.
    expect((await owner.fetch(`/api/marketing/automations/${automationId}`, { method: 'DELETE' })).status).toBeLessThan(300);
    expect((await owner.fetch(`/api/marketing/tags/${tagId}`, { method: 'DELETE' })).status).toBeLessThan(300);
  });
});
