import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from './helpers';
import { coupleTexts, db, ensureFlowVenue, FLOW_VENUE, runId, runJob, signedInOwner, submitListingLead, texts, waitForText } from './helpers';

// The AI Concierge, on the test copy (real AI, stand-in texting service): it
// writes follow-up texts; a couple's reply hands them to the venue and quiets
// it; the venue replying itself makes it step back.
const n = (parseInt(runId.slice(-5), 36) % 9000) + 1000;
const phoneC = `(646) 557-${n}`;
const phoneD = `(646) 558-${n}`;

async function newLead(first: string, phone: string): Promise<string> {
  const res = await submitListingLead({
    venue_id: FLOW_VENUE.id, first_name: first, last_name: 'concierge', email: `${first}.${runId}@example.com`, phone,
    guest_count: 110, message: 'Hi! Pricing please.', source: 'directory', client_ip: `192.0.2.${1 + ((n + 7) % 250)}`,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { lead_id: string }).lead_id;
}

/** As the AI leaves a couple after it ran once and paused; then the venue turns it back on (the real switch). */
async function aiOnFor(owner: Browser, leadId: string) {
  const now = Date.now();
  const { error } = await db.from('leads').update({
    ai_state: 'paused', ai_first_activated_at: new Date(now).toISOString(), ai_expires_at: new Date(now + 60 * 86_400_000).toISOString(),
  }).eq('id', leadId);
  if (error) throw new Error(error.message);
  const on = await owner.fetch(`/api/dashboard/leads/${leadId}/ai`, { method: 'POST', json: { action: 're_enable' } });
  expect(on.status, await on.clone().text()).toBe(200);
}

const aiState = async (leadId: string) => String((await db.from('leads').select('ai_state').eq('id', leadId).single()).data?.ai_state);

async function waitForAiState(leadId: string, done: (s: string) => boolean, timeoutMs = 45_000): Promise<string> {
  const until = Date.now() + timeoutMs;
  let s = await aiState(leadId);
  while (!done(s) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1500));
    s = await aiState(leadId);
  }
  return s;
}

describe('the AI Concierge', () => {
  let owner: Browser;
  let since = '';

  beforeAll(async () => {
    await ensureFlowVenue();
    const { error } = await db.from('venues').update({ ai_concierge_enabled: true, directory_addon_concierge: true, a2p_verified: true }).eq('id', FLOW_VENUE.id);
    if (error) throw new Error(`turning the AI on: ${error.message}`);
    owner = await signedInOwner();
    since = new Date().toISOString();
  });

  afterAll(async () => {
    await db.from('venues').update({ ai_concierge_enabled: false, directory_addon_concierge: false, a2p_verified: false }).eq('id', FLOW_VENUE.id);
  });

  let leadC = '';

  it('turned on for a couple, it writes and sends a follow-up text', async () => {
    leadC = await newLead('morgan', phoneC);
    await waitForText(phoneC, since, (b) => /guide/i.test(b));
    await aiOnFor(owner, leadC);
    expect(await aiState(leadC)).toBe('ai_active');

    const before = new Date().toISOString();
    const send = await owner.fetch(`/api/listing/ai-concierge/leads/${leadC}/force-send`, { method: 'POST' });
    expect(send.status, await send.clone().text()).toBe(200);
    const t = await waitForText(phoneC, before, () => true, 60_000);
    expect(t.body.trim().length).toBeGreaterThan(10);
    expect(t.body.length).toBeLessThanOrEqual(320);
  });

  it('a couple asking for a tour is handed to the venue, and the AI goes quiet', async () => {
    await coupleTexts(phoneC, 'We would love to come see it! Can we book a tour this Saturday?');
    expect((await runJob('ghl-inbound-sync')).status).toBe(200);
    const state = await waitForAiState(leadC, (s) => s !== 'ai_active');
    expect(['handoff', 'paused']).toContain(state);
    const before = new Date().toISOString();
    const send = await owner.fetch(`/api/listing/ai-concierge/leads/${leadC}/force-send`, { method: 'POST' });
    expect(send.status).toBe(409);
    expect((await texts(phoneC, before)).filter((x) => x.direction === 'outbound')).toHaveLength(0);
  });

  it('when the venue replies from the inbox, the AI steps back', async () => {
    const leadD = await newLead('avery', phoneD);
    await waitForText(phoneD, since, (b) => /guide/i.test(b));
    await aiOnFor(owner, leadD);
    expect(await aiState(leadD)).toBe('ai_active');

    const { data: vc } = await db.from('venue_customers').select('id').eq('venue_id', FLOW_VENUE.id).ilike('customer_email', `avery.${runId}@example.com`).single();
    const { data: thread } = await db.from('conversation_threads').select('id').eq('venue_customer_id', vc!.id).limit(1).single();
    const reply = await owner.fetch(`/api/conversations/threads/${thread!.id}/messages`, {
      method: 'POST', json: { visibility: 'external', external_channel: 'sms', body: 'Hi Avery! This is the owner. Happy to help with dates.' },
    });
    expect(reply.status, await reply.clone().text()).toBeLessThan(300);
    expect(await waitForAiState(leadD, (s) => s !== 'ai_active', 15_000)).toBe('paused');
  });
});
