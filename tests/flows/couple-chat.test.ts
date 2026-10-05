import { createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { Browser, db, ensureFlowVenue, env, FLOW_VENUE, runId, signedInOwner, signedInSuperAdmin } from './helpers';

// The couple's Wedding Planner chat with her venue (owner's rule, Oct 5 2026):
// "it should just be basic messages back and forth between the venue owner
// and the bride." The venue and support see everything in her thread; she
// sees what she wrote and what a person wrote back, and nothing else.
//
// Until that day her chat showed every outward message in the thread, so the
// automated "Guide sent via SMS" note, the AI's follow-ups and the venue's
// CRM reminders all read to her as messages from her venue, and each one lit
// up her unread badge.
const n = (parseInt(runId.slice(-5), 36) % 9000) + 1000;
const email = `wren.chat.${runId}@example.com`;
const password = `Wren-${runId}-Chat-2027!`;

let owner: Browser;
let admin: Browser;
let token = '';
let threadId = '';

const couple = (path: string, init: { method?: string; json?: unknown } = {}) =>
  fetch(`${env.base}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'x-staging-key': env.stagingKey, authorization: `Bearer ${token}`,
      ...(init.json !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
  });

type ChatMessage = { id: string; body: string; mine: boolean; author: string };
/** Her chat, as the Wedding Planner's Messages tab loads it (which also marks it read). */
const chat = async (): Promise<ChatMessage[]> => {
  const res = await couple('/api/couple/messages');
  expect(res.status, await res.clone().text()).toBe(200);
  const data = (await res.json()) as { linked: boolean; messages: ChatMessage[] };
  expect(data.linked).toBe(true);
  return data.messages;
};
/** The number on her Messages badge. */
const unread = async (): Promise<number> => {
  const res = await couple('/api/couple/wedding');
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as { link: { thread: { unread: number } } }).link.thread.unread;
};
/** A row written into her thread the way the app's own automations write theirs. */
const stored = async (row: Record<string, unknown>) => {
  const { error } = await db.from('conversation_messages').insert({ thread_id: threadId, channel: 'sms', external_email_sent: true, ...row });
  expect(error).toBeNull();
};
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

const hers = `Hi! Can we bring our own florist? ${runId}`;
const ownersReply = `Of course you can. Send her our way! ${runId}`;
const conciergesReply = `Happy to help with the florist list too. ${runId}`;
const guideNote = `📱 Guide sent via SMS:\nHi Wren! Here is your pricing guide ${runId}`;
const aiFollowUp = `Hi Wren, just checking in on your date ${runId}`;
const crmReminder = `Reminder: your tour at Flow Test Venue is tomorrow at 2. ${runId}`;
const ownersNote = `Note to self: she wants peonies ${runId}`;
const supportsNote = `Support note: called her mom ${runId}`;
const sideChannel = `To the venue: she asked about Sunday rates ${runId}`;
const ownersSideReply = `To the concierge: Sundays are 20% less ${runId}`;

beforeAll(async () => {
  await ensureFlowVenue();
  owner = await signedInOwner();
  admin = await signedInSuperAdmin();

  const signup = await fetch(`${env.base}/api/couple/signup`, {
    method: 'POST', headers: { 'x-staging-key': env.stagingKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, first_name: 'Wren', last_name: 'Chat', phone: `(646) 562-${n}` }),
  });
  expect(signup.status, await signup.clone().text()).toBe(200);
  const anon = createClient(env.supabaseUrl, String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY), { auth: { persistSession: false } });
  const auth = await anon.auth.signInWithPassword({ email, password });
  if (auth.error) throw new Error(`couple sign-in: ${auth.error.message}`);
  token = auth.data.session!.access_token;

  // She asks to connect with the venue; the venue says yes.
  const asked = await couple('/api/couple/wedding', { method: 'POST', json: { slug: FLOW_VENUE.slug, message: 'We booked June 12!' } });
  expect(asked.status, await asked.clone().text()).toBe(200);
  const requestId = ((await asked.json()) as { link: { id: string } }).link.id;
  const approved = await owner.fetch('/api/venue/wedding-planner/decide', { method: 'POST', json: { id: requestId, action: 'approve' } });
  expect(approved.status, await approved.clone().text()).toBe(200);

  // Opening her Messages tab starts the thread she shares with the venue.
  expect(await chat()).toEqual([]);
  const { data: wedding } = await db.from('couple_weddings').select('venue_customer_id').eq('id', requestId).single();
  const { data: thread } = await db.from('conversation_threads').select('id')
    .eq('venue_id', FLOW_VENUE.id).eq('venue_customer_id', wedding!.venue_customer_id).limit(1).single();
  threadId = thread!.id as string;
});

describe('the couple’s chat with her venue', () => {
  it('she writes, the owner answers, the concierge answers for the venue: all three are in her chat', async () => {
    const sent = await couple('/api/couple/messages', { method: 'POST', json: { body: hers } });
    expect(sent.status, await sent.clone().text()).toBe(200);

    const fromOwner = await owner.fetch(`/api/conversations/threads/${threadId}/messages`, {
      method: 'POST', json: { visibility: 'external', external_channel: 'email', email_subject: `Your florist ${runId}`, body: ownersReply },
    });
    expect(fromOwner.status, await fromOwner.clone().text()).toBeLessThan(300);

    const fromConcierge = await admin.fetch('/api/admin/support/bride-reply', {
      method: 'POST', json: { threadId, channel: 'email', body: conciergesReply },
    });
    expect(fromConcierge.status, await fromConcierge.clone().text()).toBeLessThan(300);

    const messages = await chat();
    expect(messages.map((m) => m.body)).toEqual([hers, ownersReply, conciergesReply]);
    expect(messages.map((m) => m.mine)).toEqual([true, false, false]);
    // What the venue's side says reaches her under the venue's name, whoever wrote it.
    expect(messages.slice(1).map((m) => m.author)).toEqual([FLOW_VENUE.name, FLOW_VENUE.name]);
  });

  it('nothing else in her thread reaches her: automated texts, the AI, notes, the venue ↔ concierge channel', async () => {
    await stored({ visibility: 'external', sender_kind: 'system', body: guideNote });
    await stored({ visibility: 'external', sender_kind: 'ai', body: aiFollowUp });
    await stored({ visibility: 'external', sender_kind: 'system', sent_via: 'crm_workflow', body: crmReminder });
    // Support's own note on her, and the concierge writing to the venue about her.
    const supportNote = await admin.fetch('/api/admin/support/bride-note', { method: 'POST', json: { threadId, body: supportsNote } });
    expect(supportNote.status, await supportNote.clone().text()).toBeLessThan(300);
    const toVenue = await admin.fetch('/api/admin/support/venue-direct', { method: 'POST', json: { threadId, body: sideChannel } });
    expect(toVenue.status, await toVenue.clone().text()).toBeLessThan(300);
    // The venue answering the concierge there, and its own note on her: written by
    // the owner, and still not for her.
    await stored({ visibility: 'internal', sender_kind: 'owner', channel: 'email', audience: 'venue_direct', external_email_sent: false, body: ownersSideReply });
    const note = await owner.fetch(`/api/conversations/threads/${threadId}/messages`, { method: 'POST', json: { visibility: 'internal', body: ownersNote } });
    expect(note.status, await note.clone().text()).toBeLessThan(300);
    // Every one of them is in the thread.
    const { data: rows } = await db.from('conversation_messages').select('body').eq('thread_id', threadId);
    const inThread = (rows ?? []).map((r) => r.body as string);
    for (const body of [guideNote, aiFollowUp, crmReminder, supportsNote, sideChannel, ownersSideReply, ownersNote]) expect(inThread, body).toContain(body);

    expect((await chat()).map((m) => m.body)).toEqual([hers, ownersReply, conciergesReply]);

    // The venue's own view of the same thread still has all of it.
    const venueView = await owner.fetch(`/api/conversations/threads/${threadId}/messages?nosync=1`);
    expect(venueView.status).toBe(200);
    const venueSees = ((await venueView.json()) as Array<{ body: string }>).map((m) => m.body);
    for (const body of [hers, ownersReply, conciergesReply, guideNote, aiFollowUp, crmReminder, ownersNote]) {
      expect(venueSees, body).toContain(body);
    }
    // And support's has the venue's, plus its own note.
    const supportView = await admin.fetch(`/api/admin/support/bride-thread/${threadId}`);
    expect(supportView.status, await supportView.clone().text()).toBe(200);
    const supportSees = ((await supportView.json()) as { messages: Array<{ body: string }> }).messages.map((m) => m.body);
    for (const body of [hers, ownersReply, conciergesReply, guideNote, aiFollowUp, crmReminder, supportsNote]) {
      expect(supportSees, body).toContain(body);
    }
  });

  it('her unread badge lights up for a person’s reply, never for an automated text', async () => {
    await chat(); // she has read everything
    expect(await unread()).toBe(0);
    await pause(1500); // the app's clock and the database's are not the same clock

    await stored({ visibility: 'external', sender_kind: 'system', body: `📱 Reminder sent via SMS ${runId}` });
    await stored({ visibility: 'external', sender_kind: 'ai', body: `Still thinking it over? ${runId}` });
    expect(await unread()).toBe(0);

    const reply = await owner.fetch(`/api/conversations/threads/${threadId}/messages`, {
      method: 'POST', json: { visibility: 'external', external_channel: 'email', email_subject: `One more thing ${runId}`, body: `One more thing: parking is free. ${runId}` },
    });
    expect(reply.status, await reply.clone().text()).toBeLessThan(300);
    expect(await unread()).toBe(1);
  });

  it('nobody else can read it', async () => {
    const stranger = await fetch(`${env.base}/api/couple/messages`, { headers: { 'x-staging-key': env.stagingKey } });
    expect(stranger.status).toBe(401);
  });
});
