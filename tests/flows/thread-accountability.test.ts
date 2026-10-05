import { beforeAll, describe, expect, it } from 'vitest';
import {
  Browser, coupleTexts, db, ensureFlowVenue, FLOW_VENUE, runId, runJob, signedInOwner, signedInSuperAdmin,
  submitListingLead, venueTextsFromCrm, waitForText,
} from './helpers';

// Who did what in a bride's thread (owner's asks, Oct 5 2026).
//
// 1. White Pine Manor: the owner answered a bride four times from her phone
//    (the CRM's app). StoryVenue imported only the bride's side, so support
//    saw a bride answering herself. Texts the venue side sends from outside
//    StoryVenue now come into the thread, under the name of who sent them.
// 2. Each move of a bride to another pipeline stage is one line in the
//    thread: when, where to, and who moved her. For the venue and support
//    only; the couple never sees it.
const n = (parseInt(runId.slice(-5), 36) % 9000) + 1000;
const phone = `(646) 557-${n}`;
const email = `summer.${runId}@example.com`;

let owner: Browser;
let admin: Browser;
let leadId = '';
let threadId = '';

type Text = { id: string; body: string; sender_kind: string; sent_via: string | null; sent_by_name: string | null; ghl_message_id: string | null };
const textsInThread = async (): Promise<Text[]> => {
  const { data, error } = await db.from('conversation_messages')
    .select('id, body, sender_kind, sent_via, sent_by_name, ghl_message_id, created_at')
    .eq('thread_id', threadId).eq('channel', 'sms').order('created_at', { ascending: true });
  expect(error).toBeNull();
  return (data ?? []) as Text[];
};
/** The app's text sync: how it learns of texts in the venue's texting account. */
const sync = async () => expect((await runJob('ghl-inbound-sync')).status).toBe(200);

beforeAll(async () => {
  await ensureFlowVenue();
  owner = await signedInOwner();
  admin = await signedInSuperAdmin();
  const since = new Date().toISOString();
  const res = await submitListingLead({
    venue_id: FLOW_VENUE.id, first_name: 'Summer', last_name: 'Thread', email, phone,
    guest_count: 80, message: 'Hi! Pricing please.', source: 'directory', client_ip: `192.0.2.${1 + (n % 250)}`,
  });
  expect(res.status).toBe(201);
  leadId = ((await res.json()) as { lead_id: string }).lead_id;
  // Her guide goes out by text: she's now a contact in the venue's texting account.
  await waitForText(phone, since, (b) => /guide/i.test(b));
  const { data: customer } = await db.from('venue_customers').select('id').eq('venue_id', FLOW_VENUE.id).ilike('customer_email', email).single();
  const { data: thread } = await db.from('conversation_threads').select('id').eq('venue_customer_id', customer!.id).limit(1).single();
  threadId = thread!.id as string;
});

describe('texts the venue side sends from outside StoryVenue', () => {
  const joAnn1 = `Hi! This is Jo Ann, the owner. We would love to show you around. ${runId}`;
  const joAnn2 = `Ok! I should know by 4 if that works. ${runId}`;

  it('the owner answers from her phone: both sides of the conversation are in the thread, hers under her name', async () => {
    await coupleTexts(phone, 'About 80. Could we tour this afternoon?');
    await venueTextsFromCrm(phone, joAnn1, { person: 'Jo Ann Wilkerson' });
    await coupleTexts(phone, 'Sure, we can do that!');
    await venueTextsFromCrm(phone, joAnn2, { person: 'Jo Ann Wilkerson' });
    await sync();

    const texts = await textsInThread();
    const hers = texts.filter((t) => t.sent_via === 'crm_user');
    expect(hers.map((t) => t.body)).toEqual([joAnn1, joAnn2]);
    for (const t of hers) {
      expect(t).toMatchObject({ sender_kind: 'owner', sent_by_name: 'Jo Ann Wilkerson' });
      expect(t.ghl_message_id).toBeTruthy();
    }
    // The bride's texts are still the bride's, and the two take turns as they did.
    const talk = texts.filter((t) => t.sender_kind === 'contact' || t.sent_via === 'crm_user').map((t) => t.sender_kind);
    expect(talk).toEqual(['contact', 'owner', 'contact', 'owner']);
  });

  it('a text StoryVenue sent itself is not brought in a second time', async () => {
    // The guide text and anything else the app sent are in the texting account
    // too, as outbound texts. They are recognised, not copied.
    const before = await textsInThread();
    expect(before.filter((t) => t.sent_via === 'crm_api')).toEqual([]);

    // A reply from the StoryVenue inbox, then the sync, twice over.
    const fromInbox = `Saturday at 2 works for us ${runId}`;
    const sent = await owner.fetch(`/api/conversations/threads/${threadId}/messages`, {
      method: 'POST', json: { visibility: 'external', external_channel: 'sms', body: fromInbox },
    });
    expect(sent.status, await sent.clone().text()).toBeLessThan(300);
    await sync();
    await sync();
    const after = await textsInThread();
    const copies = after.filter((t) => t.body === fromInbox);
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ sender_kind: 'owner', sent_via: null });
    // It was matched to the texting account's record of it, so it stays matched.
    expect(copies[0].ghl_message_id).toBeTruthy();
    expect(after).toHaveLength(before.length + 1);
  });

  it('a text from one of the venue’s CRM workflows is labelled as that', async () => {
    const reminder = `Reminder: your tour at Flow Test Venue is tomorrow at 2. ${runId}`;
    await venueTextsFromCrm(phone, reminder, { workflow: true });
    await sync();
    const row = (await textsInThread()).find((t) => t.body === reminder);
    expect(row).toMatchObject({ sender_kind: 'system', sent_via: 'crm_workflow', sent_by_name: null });
  });

  it('the venue and support both see who sent each one', async () => {
    const mine = await owner.fetch(`/api/conversations/threads/${threadId}/messages?nosync=1`);
    expect(mine.status).toBe(200);
    const venueSees = ((await mine.json()) as Text[]).find((m) => m.body === joAnn1);
    expect(venueSees).toMatchObject({ sent_via: 'crm_user', sent_by_name: 'Jo Ann Wilkerson' });

    const inbox = await admin.fetch(`/api/admin/support/bride-thread/${threadId}`);
    expect(inbox.status, await inbox.clone().text()).toBe(200);
    const supportSees = ((await inbox.json()) as { messages: Text[] }).messages.find((m) => m.body === joAnn1);
    expect(supportSees).toMatchObject({ sender_kind: 'owner', sent_via: 'crm_user', sent_by_name: 'Jo Ann Wilkerson' });
  });
});

describe('stage moves in the thread', () => {
  type Move = { id: string; at: string; from: string | null; to: string; by: string; byKind: string };
  const moves = async (as: Browser = owner): Promise<Move[]> => {
    const res = await as.fetch(`/api/conversations/threads/${threadId}/stage-moves`);
    expect(res.status, await res.clone().text()).toBe(200);
    return ((await res.json()) as { moves: Move[] }).moves;
  };
  let stages: Array<{ id: string; name: string; pipeline_id: string }> = [];
  const stage = (name: RegExp) => stages.find((s) => name.test(s.name))!;
  const messageCount = async () => (await db.from('conversation_messages').select('id', { count: 'exact', head: true }).eq('thread_id', threadId)).count ?? 0;

  beforeAll(async () => {
    const { data: lead } = await db.from('leads').select('pipeline_id').eq('id', leadId).single();
    const { data } = await db.from('lead_pipeline_stages').select('id, name, pipeline_id').eq('venue_id', FLOW_VENUE.id).eq('pipeline_id', lead!.pipeline_id);
    stages = (data ?? []) as typeof stages;
    expect(stage(/qualified/i)).toBeTruthy();
    expect(stage(/tour/i)).toBeTruthy();
  });

  it('the owner moves her: one line, with the stage and the owner’s name, and no message is added', async () => {
    const before = await moves();
    const messages = await messageCount();
    const res = await owner.fetch(`/api/leads/${leadId}`, { method: 'PATCH', json: { stageId: stage(/qualified/i).id } });
    expect(res.status, await res.clone().text()).toBe(200);

    const after = await moves();
    expect(after).toHaveLength(before.length + 1);
    const line = after[after.length - 1];
    expect(line).toMatchObject({ to: stage(/qualified/i).name, by: 'Flow Owner', byKind: 'owner' });
    expect(line.from).toBeTruthy();
    expect(Math.abs(Date.parse(line.at) - Date.now())).toBeLessThan(60_000);
    // A stage move is not a message: the thread's messages are untouched.
    expect(await messageCount()).toBe(messages);
  });

  it('support moves her from the inbox: the line says it was StoryVenue Support', async () => {
    const before = await moves();
    const res = await admin.fetch(`/api/admin/support/bride-thread/${threadId}/action`, { method: 'POST', json: { action: 'set_stage', stageId: stage(/tour/i).id } });
    expect(res.status, await res.clone().text()).toBeLessThan(300);
    const after = await moves();
    expect(after).toHaveLength(before.length + 1);
    expect(after[after.length - 1]).toMatchObject({ from: stage(/qualified/i).name, to: stage(/tour/i).name, byKind: 'support' });
    expect(after[after.length - 1].by).toContain('StoryVenue Support');
  });

  it('a move nobody put their name to (an automation) is still recorded, as an automation', async () => {
    const before = await moves();
    expect((await db.from('leads').update({ stage_id: stage(/qualified/i).id }).eq('id', leadId)).error).toBeNull();
    const after = await moves();
    expect(after).toHaveLength(before.length + 1);
    expect(after[after.length - 1]).toMatchObject({ to: stage(/qualified/i).name, by: 'Automation', byKind: 'automation' });
    // Saving the lead without moving her adds nothing.
    expect((await db.from('leads').update({ stage_id: stage(/qualified/i).id }).eq('id', leadId)).error).toBeNull();
    expect(await moves()).toHaveLength(after.length);
  });

  it('the support inbox shows the same lines as the venue', async () => {
    const inbox = await admin.fetch(`/api/admin/support/bride-thread/${threadId}`);
    expect(inbox.status).toBe(200);
    const { stageMoves } = (await inbox.json()) as { stageMoves: Move[] };
    expect(stageMoves.map((m) => `${m.to} by ${m.by}`)).toEqual((await moves()).map((m) => `${m.to} by ${m.by}`));
    expect(stageMoves.length).toBeGreaterThanOrEqual(3);
  });

  it('they are never messages, so they can never reach the couple; and a stranger can’t read them', async () => {
    const { data } = await db.from('conversation_messages').select('body').eq('thread_id', threadId);
    expect((data ?? []).some((m) => /moved (from|to) /i.test(String(m.body)))).toBe(false);
    expect((await new Browser().fetch(`/api/conversations/threads/${threadId}/stage-moves`)).status).toBe(401);
  });
});
