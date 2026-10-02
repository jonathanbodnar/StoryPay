import { beforeAll, describe, expect, it } from 'vitest';
import { Browser, db, outbox, runId, signedInOwner, texts, waitForEmail, waitForText } from './helpers';

// The conversations inbox: a team-only note stays inside, a reply by email or
// by text reaches the couple from the venue's name, Do Not Disturb holds, and
// a thread can be starred, pinned, marked read or unread, and deleted.
describe('the conversations inbox', () => {
  const email = `inbox.${runId}@example.com`;
  const phone = `(646) 561-${(parseInt(runId.slice(-5), 36) % 9000) + 1000}`;
  let owner: Browser;
  let contactId = '';
  let threadId = '';

  const send = (json: Record<string, unknown>) => owner.fetch(`/api/conversations/threads/${threadId}/messages`, { method: 'POST', json });
  const dnd = (fields: Record<string, boolean>) => db.from('venue_customers').update(fields).eq('id', contactId);

  beforeAll(async () => {
    owner = await signedInOwner();
    const c = await owner.fetch('/api/venue-customers', { method: 'POST', json: { customer_email: email, first_name: 'Indy', last_name: 'Inbox', phone } });
    expect(c.status, await c.clone().text()).toBeLessThan(300);
    const open = await owner.fetch(`/api/conversations/open-or-create?email=${encodeURIComponent(email)}`);
    expect(open.status, await open.clone().text()).toBe(200);
    ({ thread_id: threadId, venue_customer_id: contactId } = (await open.json()) as { thread_id: string; venue_customer_id: string });
    // Opening it again finds the same conversation.
    const again = (await (await owner.fetch(`/api/conversations/open-or-create?email=${encodeURIComponent(email)}`)).json()) as { thread_id: string };
    expect(again.thread_id).toBe(threadId);
  });

  it('a team-only note is saved and never sent', async () => {
    const since = new Date().toISOString();
    const res = await send({ visibility: 'internal', body: `Check the June dates ${runId}` });
    expect(res.status, await res.clone().text()).toBeLessThan(300);
    const { data } = await db.from('conversation_messages').select('visibility, external_email_sent').eq('thread_id', threadId).ilike('body', `%June dates ${runId}%`).single();
    expect(data).toMatchObject({ visibility: 'internal', external_email_sent: false });
    await new Promise((r) => setTimeout(r, 2000));
    expect(await outbox({ to: email, since })).toHaveLength(0);
    expect((await texts(phone, since)).filter((t) => t.direction === 'outbound')).toHaveLength(0);
  });

  it('an email reply reaches the couple from the venue', async () => {
    const since = new Date().toISOString();
    const res = await send({ visibility: 'external', external_channel: 'email', email_subject: `Your tour ${runId}`, body: 'We would love to show you the barn.' });
    expect(res.status, await res.clone().text()).toBeLessThan(300);
    const mail = await waitForEmail({ to: email, since }, (e) => e.subject === `Your tour ${runId}`);
    expect(mail.html).toContain('We would love to show you the barn.');
    const { data } = await db.from('conversation_messages').select('external_email_sent, email_to').eq('thread_id', threadId).eq('body', 'We would love to show you the barn.').single();
    expect(data).toMatchObject({ external_email_sent: true, email_to: email });
    const { data: thread } = await db.from('conversation_threads').select('subject').eq('id', threadId).single();
    expect(thread!.subject).toBe(`Your tour ${runId}`);
  });

  it('a text reply reaches the couple’s phone', async () => {
    const since = new Date().toISOString();
    const res = await send({ visibility: 'external', external_channel: 'sms', body: `Saturday at 2 works ${runId}` });
    expect(res.status, await res.clone().text()).toBeLessThan(300);
    await waitForText(phone, since, (b) => b.includes(`Saturday at 2 works ${runId}`));
    const { data } = await db.from('conversation_messages').select('channel, external_email_sent, send_error').eq('thread_id', threadId).eq('body', `Saturday at 2 works ${runId}`).single();
    expect(data).toMatchObject({ channel: 'sms', external_email_sent: true, send_error: null });
  });

  it('Do Not Disturb holds: texts after STOP, email when switched off, everything when all is off', async () => {
    const since = new Date().toISOString();
    await dnd({ sms_dnd: true });
    expect((await send({ visibility: 'external', external_channel: 'sms', body: 'Should not send' })).status).toBe(400);
    // Email still works while only texts are off.
    expect((await send({ visibility: 'external', external_channel: 'email', body: 'Email still fine' })).status).toBeLessThan(300);
    await dnd({ sms_dnd: false, conversation_dnd_email: true });
    expect((await send({ visibility: 'external', external_channel: 'email', body: 'Should not send' })).status).toBe(400);
    await dnd({ conversation_dnd_email: false, conversation_dnd_all: true });
    expect((await send({ visibility: 'external', external_channel: 'sms', body: 'Should not send' })).status).toBe(400);
    expect((await send({ visibility: 'external', external_channel: 'email', body: 'Should not send' })).status).toBe(400);
    await dnd({ conversation_dnd_all: false });
    await new Promise((r) => setTimeout(r, 2000));
    expect((await outbox({ to: email, since })).filter((e) => e.html.includes('Should not send'))).toHaveLength(0);
    expect((await texts(phone, since)).filter((t) => t.body.includes('Should not send'))).toHaveLength(0);
    const { count } = await db.from('conversation_messages').select('id', { count: 'exact', head: true }).eq('thread_id', threadId).eq('body', 'Should not send');
    expect(count).toBe(0);
  });

  it('star, pin, read and unread', async () => {
    const flag = async () => (await db.from('conversation_threads').select('is_starred, is_pinned').eq('id', threadId).single()).data!;
    expect((await owner.fetch(`/api/conversations/threads/${threadId}/toggle-star-pin`, { method: 'POST', json: { field: 'is_starred' } })).status).toBeLessThan(300);
    expect((await owner.fetch(`/api/conversations/threads/${threadId}/toggle-star-pin`, { method: 'POST', json: { field: 'is_pinned' } })).status).toBeLessThan(300);
    expect(await flag()).toMatchObject({ is_starred: true, is_pinned: true });
    expect((await owner.fetch(`/api/conversations/threads/${threadId}/toggle-star-pin`, { method: 'POST', json: { field: 'is_starred' } })).status).toBeLessThan(300);
    expect((await flag()).is_starred).toBe(false);

    expect((await owner.fetch(`/api/conversations/threads/${threadId}/read`, { method: 'POST' })).status).toBeLessThan(300);
    expect((await owner.fetch(`/api/conversations/threads/${threadId}/read`, { method: 'DELETE' })).status).toBeLessThan(300);
    expect((await owner.fetch('/api/conversations/unread-count')).status).toBe(200);

    const list = await owner.fetch('/api/conversations/threads');
    expect(list.status).toBe(200);
    expect(JSON.stringify(await list.json())).toContain(threadId);
  });

  it('deleting the conversation removes it and its messages', async () => {
    expect((await owner.fetch(`/api/conversations/threads/${threadId}`, { method: 'DELETE' })).status).toBeLessThan(300);
    expect((await db.from('conversation_threads').select('id').eq('id', threadId).maybeSingle()).data).toBeNull();
    const { count } = await db.from('conversation_messages').select('id', { count: 'exact', head: true }).eq('thread_id', threadId);
    expect(count).toBe(0);
    expect((await owner.fetch(`/api/conversations/threads/${threadId}`)).status).toBe(404);
  });
});
