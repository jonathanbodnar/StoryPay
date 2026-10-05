import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Browser, coupleTexts, db, ensureFlowVenue, FLOW_VENUE, runId, runJob, signedInOwner, signedInSuperAdmin, submitListingLead, texts, waitForText, venueTextsFromCrm } from './helpers';

// The AI Concierge, on the test copy (real AI, stand-in texting service): it
// writes follow-up texts; a couple's reply hands them to the venue and quiets
// it; the venue writing to her does not (owner's rule, Oct 5 2026).
const n = (parseInt(runId.slice(-5), 36) % 9000) + 1000;
const phoneC = `(646) 557-${n}`;
const phoneD = `(646) 558-${n}`;

/**
 * A new lead, once her pricing-guide text has gone out. The guide is sent a
 * moment after the lead is taken, so a check that "the AI texted nobody" must
 * not start before it has landed. (Oct 5 2026: under load it landed late, was
 * counted as an AI text sent in spite of the emergency stop, and failed a
 * release check. One describe had forgotten to wait; now none can.)
 */
async function newLead(first: string, phone: string): Promise<string> {
  // (The two machines' clocks aren't the same clock: look back a minute.)
  const since = new Date(Date.now() - 60_000).toISOString();
  const res = await submitListingLead({
    venue_id: FLOW_VENUE.id, first_name: first, last_name: 'concierge', email: `${first}.${runId}@example.com`, phone,
    guest_count: 110, message: 'Hi! Pricing please.', source: 'directory', client_ip: `192.0.2.${1 + ((n + 7) % 250)}`,
  });
  expect(res.status).toBe(201);
  await waitForText(phone, since, (b) => /guide/i.test(b), 45_000);
  return ((await res.json()) as { lead_id: string }).lead_id;
}

/**
 * How many texts the test copy has sent a number. "Nothing was sent" is this
 * count not moving: no clocks involved, so a text sent a moment earlier, or
 * two machines a second apart, can't be mistaken for a new one.
 */
const sentTo = async (phone: string): Promise<number> =>
  (await texts(phone, new Date(Date.now() - 6 * 3600_000).toISOString())).filter((t) => t.direction === 'outbound').length;

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

  beforeAll(async () => {
    await ensureFlowVenue();
    const { error } = await db.from('venues').update({ ai_concierge_enabled: true, directory_addon_concierge: true, a2p_verified: true }).eq('id', FLOW_VENUE.id);
    if (error) throw new Error(`turning the AI on: ${error.message}`);
    owner = await signedInOwner();
  });

  afterAll(async () => {
    await db.from('venues').update({ ai_concierge_enabled: false, directory_addon_concierge: false, a2p_verified: false }).eq('id', FLOW_VENUE.id);
  });

  let leadC = '';

  it('turned on for a couple, it writes and sends a follow-up text', async () => {
    leadC = await newLead('morgan', phoneC);
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
    const before = await sentTo(phoneC);
    const send = await owner.fetch(`/api/listing/ai-concierge/leads/${leadC}/force-send`, { method: 'POST' });
    expect(send.status).toBe(409);
    expect(await sentTo(phoneC)).toBe(before);
  });

  // Owner's rule (Oct 5 2026): "The AI should never pause unless the bride
  // replies. If the venue owner does outward lead generation questions in AI,
  // they're on the same team." (Until then a reply from the venue's inbox, by
  // email, or from support paused it.)
  it('the venue writing to a couple does not stop the AI; her own reply does, and she moves to Conversations Started', async () => {
    const leadD = await newLead('avery', phoneD);
    await aiOnFor(owner, leadD);
    expect(await aiState(leadD)).toBe('ai_active');

    // The owner writes to her from the StoryVenue inbox…
    const { data: vc } = await db.from('venue_customers').select('id').eq('venue_id', FLOW_VENUE.id).ilike('customer_email', `avery.${runId}@example.com`).single();
    const { data: thread } = await db.from('conversation_threads').select('id').eq('venue_customer_id', vc!.id).limit(1).single();
    const reply = await owner.fetch(`/api/conversations/threads/${thread!.id}/messages`, {
      method: 'POST', json: { visibility: 'external', external_channel: 'sms', body: 'Hi Avery! This is the owner. Happy to help with dates.' },
    });
    expect(reply.status, await reply.clone().text()).toBeLessThan(300);
    // …and again from her phone, through the venue's texting app.
    await venueTextsFromCrm(phoneD, `One more thing, Avery: we just opened two Saturdays in June. ${runId}`, { person: 'Jo Ann Wilkerson' });
    expect((await runJob('ghl-inbound-sync')).status).toBe(200);
    await new Promise((r) => setTimeout(r, 3000));
    // Same team: the AI is still on, and still follows up.
    expect(await aiState(leadD)).toBe('ai_active');
    const before = new Date().toISOString();
    const send = await owner.fetch(`/api/listing/ai-concierge/leads/${leadD}/force-send`, { method: 'POST' });
    expect(send.status, await send.clone().text()).toBe(200);
    await waitForText(phoneD, before, () => true, 60_000);

    // Her reply is what stops it, and it moves her to Conversations Started.
    await coupleTexts(phoneD, 'Thank you so much!');
    expect((await runJob('ghl-inbound-sync')).status).toBe(200);
    expect(await waitForAiState(leadD, (s) => s !== 'ai_active')).toBe('paused');
    const { data: lead } = await db.from('leads').select('stage_id').eq('id', leadD).single();
    const { data: stage } = await db.from('lead_pipeline_stages').select('name').eq('id', lead!.stage_id as string).single();
    expect(stage!.name).toMatch(/conversation/i);
    const quiet = await owner.fetch(`/api/listing/ai-concierge/leads/${leadD}/force-send`, { method: 'POST' });
    expect(quiet.status).toBe(409);
  });
});

// The controls: the emergency stop (StoryVenue team), and per couple, snooze
// and pause/resume (the venue). If the stop button fails, the AI keeps texting.
describe('the AI Concierge controls', () => {
  const phoneE = `(646) 554-${n}`;
  let owner: Browser;
  let leadE = '';

  beforeAll(async () => {
    await db.from('venues').update({ ai_concierge_enabled: true, directory_addon_concierge: true, a2p_verified: true }).eq('id', FLOW_VENUE.id);
    owner = await signedInOwner();
    leadE = await newLead('emma', phoneE);
    await aiOnFor(owner, leadE);
  });

  afterAll(async () => {
    const admin = await signedInSuperAdmin();
    await admin.fetch('/api/admin/ai-concierge/kill-switch', { method: 'PATCH', json: { enabled: false } });
    await db.from('venues').update({ ai_concierge_enabled: false, directory_addon_concierge: false, a2p_verified: false }).eq('id', FLOW_VENUE.id);
  });

  it('the emergency stop stops every AI text until it’s switched off', async () => {
    const admin = await signedInSuperAdmin();
    const stop = await admin.fetch('/api/admin/ai-concierge/kill-switch', { method: 'PATCH', json: { enabled: true, reason: `flow test ${runId}` } });
    expect(stop.status, await stop.clone().text()).toBe(200);
    const before = await sentTo(phoneE);
    const send = await owner.fetch(`/api/listing/ai-concierge/leads/${leadE}/force-send`, { method: 'POST' });
    expect(send.status).toBe(409);
    expect(((await send.json()) as { reason?: string }).reason).toBe('kill_switch');
    expect((await runJob('ai-send')).status).toBe(200);
    expect(await sentTo(phoneE)).toBe(before);
    const go = await admin.fetch('/api/admin/ai-concierge/kill-switch', { method: 'PATCH', json: { enabled: false } });
    expect(go.status).toBe(200);
    expect(((await (await admin.fetch('/api/admin/ai-concierge/kill-switch')).json()) as { killSwitchEnabled: boolean }).killSwitchEnabled).toBe(false);
  });

  it('pausing a couple stops the AI for them; resuming starts it again', async () => {
    expect((await owner.fetch(`/api/listing/ai-concierge/leads/${leadE}/state`, { method: 'PATCH', json: { action: 'pause' } })).status).toBe(200);
    expect(await aiState(leadE)).toBe('paused');
    const before = await sentTo(phoneE);
    await owner.fetch(`/api/listing/ai-concierge/leads/${leadE}/force-send`, { method: 'POST' });
    expect(await sentTo(phoneE)).toBe(before);
    expect((await owner.fetch(`/api/listing/ai-concierge/leads/${leadE}/state`, { method: 'PATCH', json: { action: 'resume' } })).status).toBe(200);
    expect(await aiState(leadE)).toBe('ai_active');
  });

  it('snoozing a couple holds the next AI text back', async () => {
    const res = await owner.fetch(`/api/listing/ai-concierge/leads/${leadE}/snooze`, { method: 'PATCH', json: { minutes: 120 } });
    expect(res.status, await res.clone().text()).toBe(200);
    const { data } = await db.from('leads').select('ai_next_send_at').eq('id', leadE).single();
    expect(Date.parse(data!.ai_next_send_at)).toBeGreaterThan(Date.now() + 100 * 60_000);
    const before = await sentTo(phoneE);
    expect((await runJob('ai-send')).status).toBe(200);
    expect(await sentTo(phoneE)).toBe(before);
  });

  it('another venue can’t control their couple', async () => {
    const other = new Browser();
    await other.signIn(process.env.ADMIN_EMAIL || '');
    expect([403, 404]).toContain((await other.fetch(`/api/listing/ai-concierge/leads/${leadE}/state`, { method: 'PATCH', json: { action: 'pause' } })).status);
    expect(await aiState(leadE)).toBe('ai_active');
  });
});
