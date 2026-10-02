import { beforeAll, describe, expect, it } from 'vitest';
import { db, env, FLOW_VENUE, runId, runJob, submitListingLead, texts, waitForText } from './helpers';

// Texts that arrive through GoHighLevel's webhook (how venues on live webhooks
// get replies instantly, rather than through the every-minute sync): a reply
// reaches the venue's conversation and stops the follow-ups, a duplicate
// delivery is stored once, STOP turns texting off and START turns it back on.
const n = (parseInt(runId.slice(-5), 36) % 9000) + 1000;
const phone = `(646) 557-${n}`;
const email = `webhook.${runId}@example.com`;

describe('texts arriving through the GoHighLevel webhook', () => {
  let leadId = '';
  let contactId = '';
  let customerId = '';
  let since = '';
  let seq = 0;

  const deliver = (body: string, messageId = `wh-${runId}-${++seq}`) => fetch(`${env.base}/api/webhooks/ghl`, {
    method: 'POST',
    headers: { 'x-staging-key': env.stagingKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'InboundMessage', locationId: 'staging-flow-location', contactId, body, messageType: 'SMS',
      direction: 'inbound', messageId, dateAdded: new Date().toISOString(),
    }),
  });

  const replies = async () => {
    const { data: threads } = await db.from('conversation_threads').select('id').eq('venue_customer_id', customerId);
    const { data } = await db.from('conversation_messages').select('body').in('thread_id', (threads ?? []).map((t) => t.id)).eq('sender_kind', 'contact');
    return (data ?? []).map((m) => String(m.body));
  };

  beforeAll(async () => {
    since = new Date().toISOString();
    const res = await submitListingLead({
      venue_id: FLOW_VENUE.id, first_name: 'Wren', last_name: 'Webhook', email, phone,
      guest_count: 120, message: 'Pricing please', source: 'directory', client_ip: `192.0.2.${(n % 200) + 20}`,
    });
    expect(res.status).toBe(201);
    leadId = ((await res.json()) as { lead_id: string }).lead_id;
    await waitForText(phone, since, (b) => /guide/i.test(b)); // the guide went out, so the contact exists
    const res2 = await fetch(`${env.base}/api/staging/sms?phone=${encodeURIComponent(phone)}&since=${encodeURIComponent(since)}`, { headers: { 'x-staging-key': env.stagingKey } });
    const sent = ((await res2.json()) as { texts: Array<{ contactId?: string }> }).texts;
    contactId = sent.find((t) => t.contactId)?.contactId ?? '';
    expect(contactId).toBeTruthy();
    const { data: vc } = await db.from('venue_customers').select('id').eq('venue_id', FLOW_VENUE.id).ilike('customer_email', email).single();
    customerId = vc!.id;
  });

  it('a reply lands in the venue’s conversation at once, and the follow-ups stop', async () => {
    expect((await deliver('We would love a Saturday tour!')).status).toBe(200);
    expect(await replies()).toContain('We would love a Saturday tour!');
    const { data: lead } = await db.from('leads').select('last_inbound_at').eq('id', leadId).single();
    expect(lead!.last_inbound_at).toBeTruthy();
    await db.from('marketing_automation_enrollments').update({ next_run_at: new Date().toISOString() }).eq('lead_id', leadId).eq('status', 'active');
    const before = (await texts(phone, since)).filter((t) => t.direction === 'outbound').length;
    expect((await runJob('marketing-email')).status).toBe(200);
    expect((await texts(phone, since)).filter((t) => t.direction === 'outbound').length).toBe(before);
  });

  it('the same message delivered twice is stored once', async () => {
    const id = `wh-${runId}-dup`;
    expect((await deliver('Is October 10 open?', id)).status).toBe(200);
    expect((await deliver('Is October 10 open?', id)).status).toBe(200);
    expect((await replies()).filter((b) => b === 'Is October 10 open?')).toHaveLength(1);
  });

  it('STOP turns their texts off; START turns them back on', async () => {
    expect((await deliver('STOP')).status).toBe(200);
    const { data: stopped } = await db.from('leads').select('sms_dnd').eq('id', leadId).single();
    expect(stopped!.sms_dnd).toBe(true);
    expect((await deliver('START')).status).toBe(200);
    const { data: back } = await db.from('leads').select('sms_dnd').eq('id', leadId).single();
    expect(back!.sms_dnd).toBe(false);
  });
});
