import { beforeAll, describe, expect, it } from 'vitest';
import { coupleReacts, coupleTexts, db, ensureFlowVenue, FLOW_VENUE, runId, runJob, submitListingLead, texts, waitForText } from './helpers';

// Texting end to end, against the test copy's stand-in texting service
// (lib/staging-ghl): the guide by text, the follow-ups, a couple texting back,
// STOP. Nothing reaches a real phone.
const n = (parseInt(runId.slice(-5), 36) % 9000) + 1000;
const phoneA = `(646) 555-${n}`;
const phoneB = `(646) 556-${n}`;
const phoneC = `(646) 571-${n}`;

const textsTo = async (phone: string, since: string) => (await texts(phone, since)).filter((t) => t.direction === 'outbound');

/** The next step of their follow-up sequence comes due, and the sequence job runs. */
async function nextStepDue(leadId: string) {
  await db.from('marketing_automation_enrollments').update({ next_run_at: new Date().toISOString() }).eq('lead_id', leadId).eq('status', 'active');
  expect((await runJob('marketing-email')).status).toBe(200);
}

async function newLead(first: string, phone: string): Promise<string> {
  const res = await submitListingLead({
    venue_id: FLOW_VENUE.id, first_name: first, last_name: 'texting', email: `${first}.${runId}@example.com`, phone,
    guest_count: 90, message: 'Hi! Pricing please.', source: 'directory', client_ip: `192.0.2.${1 + (n % 250)}`,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { lead_id: string }).lead_id;
}

async function repliesInConversation(email: string): Promise<string[]> {
  const { data: vc } = await db.from('venue_customers').select('id').eq('venue_id', FLOW_VENUE.id).ilike('customer_email', email).single();
  const { data: threads } = await db.from('conversation_threads').select('id').eq('venue_customer_id', vc!.id);
  const { data: msgs } = await db.from('conversation_messages').select('body').in('thread_id', (threads ?? []).map((t) => t.id)).eq('sender_kind', 'contact');
  return (msgs ?? []).map((m) => String(m.body));
}

describe('texting a couple', () => {
  let leadA = '';
  let since = '';

  beforeAll(async () => {
    await ensureFlowVenue();
    since = new Date().toISOString();
  });

  it('sends the guide by text, with their name and the guide link', async () => {
    leadA = await newLead('riley', phoneA);
    const t = await waitForText(phoneA, since, (b) => /guide/i.test(b));
    expect(t.body).toContain('Riley');
    expect(t.body).toMatch(/https?:\/\/\S+\/(g|guide)\//);
  });

  it('texts the first follow-up when it comes due', async () => {
    const before = new Date().toISOString();
    await nextStepDue(leadA); // the 1-day wait
    await nextStepDue(leadA); // Day 1
    await waitForText(phoneA, before, (b) => /just making sure/i.test(b));
  });

  it('their text back reaches the venue’s conversation, and the follow-ups stop', async () => {
    await coupleTexts(phoneA, 'Yes! We are thinking June 14, 2027.');
    expect((await runJob('ghl-inbound-sync')).status).toBe(200);
    expect(await repliesInConversation(`riley.${runId}@example.com`)).toContain('Yes! We are thinking June 14, 2027.');

    const before = new Date().toISOString();
    await nextStepDue(leadA);
    await nextStepDue(leadA);
    expect(await textsTo(phoneA, before)).toHaveLength(0);
    const { data: ens } = await db.from('marketing_automation_enrollments').select('last_error').eq('lead_id', leadA);
    expect(ens!.some((e) => e.last_error === 'stopped_on_reply')).toBe(true);
  });

  it('a reply the sync hasn’t picked up yet still stops the next follow-up', async () => {
    const leadB = await newLead('cameron', phoneB);
    await waitForText(phoneB, since, (b) => /guide/i.test(b));
    await nextStepDue(leadB); // the 1-day wait
    await coupleTexts(phoneB, 'We already booked a tour with you!');
    const before = new Date().toISOString();
    await nextStepDue(leadB); // Day 1 comes due before any reply sync ran
    expect(await textsTo(phoneB, before)).toHaveLength(0);
    const { data: ens } = await db.from('marketing_automation_enrollments').select('last_error').eq('lead_id', leadB);
    expect(ens!.some((e) => e.last_error === 'stopped_on_reply')).toBe(true);
    expect(await repliesInConversation(`cameron.${runId}@example.com`)).toContain('We already booked a tour with you!');
  });

  // Owner, Oct 7 2026: "if the bride likes something, we should show it, but
  // it should not stop any of the follow-ups." Until then a reaction was
  // dropped on its way in, or (where texts are pushed to us) kept as her reply.
  it('a couple’s “Liked” shows in the conversation, and their follow-ups carry on', async () => {
    const email = `jordan.${runId}@example.com`;
    const leadC = await newLead('jordan', phoneC);
    await waitForText(phoneC, since, (b) => /guide/i.test(b));
    await nextStepDue(leadC); // the 1-day wait

    const liked = 'Liked “Hi Jordan! Here is your pricing guide”';
    await coupleReacts(phoneC, liked);
    // The follow-up comes due before any sync ran: looking for an unseen reply
    // finds her reaction, which is not one, and the text goes out.
    const before = new Date().toISOString();
    await nextStepDue(leadC); // Day 1
    await waitForText(phoneC, before, (b) => /just making sure/i.test(b));
    expect((await runJob('ghl-inbound-sync')).status).toBe(200);

    // It is in the thread once, as a reaction beside her name: not as her text.
    const { data: vc } = await db.from('venue_customers').select('id').eq('venue_id', FLOW_VENUE.id).ilike('customer_email', email).single();
    const { data: threads } = await db.from('conversation_threads').select('id').eq('venue_customer_id', vc!.id);
    const { data: rows } = await db.from('conversation_messages').select('body, sender_kind, sent_via, visibility, channel')
      .in('thread_id', (threads ?? []).map((t) => t.id));
    const hers = (rows ?? []).filter((m) => m.body === liked);
    expect(hers).toHaveLength(1);
    expect(hers[0]).toMatchObject({ sender_kind: 'system', sent_via: 'reaction', visibility: 'external', channel: 'sms' });
    expect((rows ?? []).filter((m) => m.sender_kind === 'contact')).toHaveLength(0);

    // Nothing says she wrote, and nothing stopped.
    const { data: lead } = await db.from('leads').select('last_inbound_at').eq('id', leadC).single();
    expect(lead!.last_inbound_at).toBeNull();
    const { data: ens } = await db.from('marketing_automation_enrollments').select('last_error').eq('lead_id', leadC);
    expect(ens!.some((e) => e.last_error === 'stopped_on_reply')).toBe(false);
  });

  it('STOP turns their texts off', async () => {
    await coupleTexts(phoneA, 'STOP');
    expect((await runJob('ghl-inbound-sync')).status).toBe(200);
    const { data: lead } = await db.from('leads').select('sms_dnd').eq('id', leadA).single();
    expect(lead!.sms_dnd).toBe(true);
  });
});
