import { beforeEach, describe, expect, it } from 'vitest';
import { clearFakeGhl, fakeGhlFetch, readFakeTexts, receiveFakeText } from '@/lib/staging-ghl';

const call = async (path: string, init?: { method?: string; body?: unknown }) =>
  (await fakeGhlFetch(`https://services.leadconnectorhq.com${path}`, init && { method: init.method, body: JSON.stringify(init.body) })).json();

describe('the test copy’s stand-in texting service', () => {
  beforeEach(() => clearFakeGhl());

  it('records a text instead of sending it, and finds the contact again', async () => {
    const { contact } = await call('/contacts/', { method: 'POST', body: { locationId: 'loc', email: 'Ava@Example.com', phone: '+12125550188', firstName: 'Ava' } });
    expect((await call('/contacts/search/duplicate?locationId=loc&number=%2B12125550188')).contact.id).toBe(contact.id);
    expect((await call('/contacts/search/duplicate?locationId=loc&email=ava%40example.com')).contact.id).toBe(contact.id);
    const { conversation } = await call('/conversations/', { method: 'POST', body: { locationId: 'loc', contactId: contact.id } });
    await call('/conversations/messages', { method: 'POST', body: { type: 'SMS', conversationId: conversation.id, contactId: contact.id, message: 'Your guide!' } });
    expect(readFakeTexts({ phone: '(212) 555-0188' }).map((t) => [t.direction, t.body])).toEqual([['outbound', 'Your guide!']]);
  });

  it('a couple’s reply waits in the conversation, the way the app’s reply sync reads it', async () => {
    const { contact } = await call('/contacts/', { method: 'POST', body: { locationId: 'loc', phone: '+12125550177' } });
    expect(receiveFakeText('212-555-0199', 'wrong number')).toBeNull();
    const r = receiveFakeText('(212) 555-0177', 'June 14!')!;
    expect(r.contactId).toBe(contact.id);
    const search = await call(`/conversations/search?locationId=loc&contactId=${contact.id}`);
    expect(search.conversations.map((c: { id: string }) => c.id)).toEqual([r.conversationId]);
    const list = await call(`/conversations/${r.conversationId}/messages`);
    expect(list.messages.messages[0]).toMatchObject({ direction: 'inbound', type: 2, body: 'June 14!' });
  });

  it('unknown contacts get GHL’s not-found error', async () => {
    const res = await fakeGhlFetch('https://services.leadconnectorhq.com/contacts/nope');
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('Contact not found');
  });
});
