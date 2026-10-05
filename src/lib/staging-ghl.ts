/**
 * The test copy's stand-in for GoHighLevel (texting + CRM). In the test copy,
 * every GHL API call is answered here instead of reaching the real service
 * (the fetch guard in lib/staging.ts): texts are recorded, never sent, and a
 * test can play a couple texting back (GET/POST /api/staging/sms). In memory
 * like the email outbox: a restart clears it. Live site: never used.
 */

import { recordOutbox } from '@/lib/staging-outbox';

interface FakeContact {
  id: string;
  locationId: string;
  email: string | null;
  phone: string | null;
  firstName: string;
  lastName: string;
  dnd: boolean;
  tags: string[];
  dateAdded: string;
}

interface FakeMessage {
  id: string;
  conversationId: string;
  contactId: string;
  locationId: string;
  direction: 'inbound' | 'outbound';
  body: string;
  dateAdded: string;
  /** How GHL says an outbound text was sent: 'app' (through the API, or a person in the CRM's app), 'workflow'. */
  source?: string;
  /** Set when a person sent it from the CRM's app. */
  userId?: string;
}

interface FakeGhl {
  /** CRM users (people at the venue who can text from the CRM's app): id → name. */
  users?: Map<string, string>;
  contacts: Map<string, FakeContact>;
  conversations: Map<string, { id: string; contactId: string; locationId: string; dateUpdated: string }>;
  messages: FakeMessage[];
  seq: number;
}

export interface FakeText {
  at: string;
  direction: 'inbound' | 'outbound';
  phone: string | null;
  body: string;
  contactId: string;
  locationId: string;
}

const MAX_MESSAGES = 2000;
const store = globalThis as typeof globalThis & { __stagingGhl?: FakeGhl };
const ghl = (): FakeGhl => (store.__stagingGhl ??= { contacts: new Map(), conversations: new Map(), messages: [], seq: 0 });
const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(++ghl().seq).toString(36)}`;
const digits = (p: string | null | undefined) => String(p ?? '').replace(/\D/g, '').slice(-10);
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

function apiContact(c: FakeContact) {
  return {
    id: c.id, locationId: c.locationId, email: c.email, phone: c.phone,
    firstName: c.firstName, lastName: c.lastName, contactName: `${c.firstName} ${c.lastName}`.trim(),
    dnd: c.dnd, dndSettings: c.dnd ? { SMS: { status: 'active' } } : {}, tags: c.tags, dateAdded: c.dateAdded,
  };
}

function apiMessage(m: FakeMessage) {
  return {
    id: m.id, conversationId: m.conversationId, contactId: m.contactId, locationId: m.locationId,
    direction: m.direction, type: 2, messageType: 'TYPE_SMS', body: m.body, dateAdded: m.dateAdded,
    status: 'delivered',
    ...(m.direction === 'outbound' ? { source: m.source ?? 'app' } : {}),
    ...(m.userId ? { userId: m.userId } : {}),
  };
}

function findContact(locationId: string | null, by: { email?: string | null; phone?: string | null }): FakeContact | undefined {
  const email = by.email?.trim().toLowerCase();
  const phone = digits(by.phone);
  for (const c of ghl().contacts.values()) {
    if (locationId && c.locationId !== locationId) continue;
    if (email && c.email?.toLowerCase() === email) return c;
    if (phone && digits(c.phone) === phone) return c;
  }
  return undefined;
}

function upsertContact(locationId: string, b: Record<string, unknown>): FakeContact {
  const existing = findContact(locationId, { email: b.email as string, phone: b.phone as string });
  const c: FakeContact = existing ?? {
    id: newId('ct'), locationId, email: null, phone: null, firstName: '', lastName: '', dnd: false, tags: [],
    dateAdded: new Date().toISOString(),
  };
  if (typeof b.email === 'string' && b.email) c.email = b.email.toLowerCase();
  if (typeof b.phone === 'string' && b.phone) c.phone = b.phone;
  if (typeof b.firstName === 'string') c.firstName = b.firstName;
  if (typeof b.lastName === 'string') c.lastName = b.lastName;
  ghl().contacts.set(c.id, c);
  return c;
}

function conversationFor(contact: FakeContact) {
  for (const conv of ghl().conversations.values()) if (conv.contactId === contact.id) return conv;
  const conv = { id: newId('cv'), contactId: contact.id, locationId: contact.locationId, dateUpdated: new Date().toISOString() };
  ghl().conversations.set(conv.id, conv);
  return conv;
}

function addMessage(contact: FakeContact, direction: FakeMessage['direction'], body: string, sent: { source?: string; userId?: string } = {}): FakeMessage {
  const conv = conversationFor(contact);
  const m: FakeMessage = {
    id: newId('ms'), conversationId: conv.id, contactId: contact.id, locationId: contact.locationId,
    direction, body, dateAdded: new Date().toISOString(), ...sent,
  };
  conv.dateUpdated = m.dateAdded;
  const box = ghl().messages;
  box.push(m);
  if (box.length > MAX_MESSAGES) box.splice(0, box.length - MAX_MESSAGES);
  return m;
}

/** Answers one GHL API call (the parts of the API the app uses). */
export async function fakeGhlFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const req = input instanceof Request ? input : null;
  const url = new URL(req ? req.url : String(input));
  const method = (init?.method ?? req?.method ?? 'GET').toUpperCase();
  const rawBody = init?.body != null ? String(init.body) : req ? await req.text() : '';
  let b: Record<string, unknown> = {};
  try { b = rawBody ? JSON.parse(rawBody) : {}; } catch { /* not JSON */ }
  const path = url.pathname.replace(/^\/v1/, '').replace(/\/+$/, '') || '/';
  const q = url.searchParams;
  const parts = path.split('/').filter(Boolean);
  const loc = q.get('locationId') ?? (typeof b.locationId === 'string' ? b.locationId : null);

  // Contacts
  if (path === '/contacts/search/duplicate') {
    const c = findContact(loc, { email: q.get('email'), phone: q.get('number') });
    return json({ contact: c ? apiContact(c) : null });
  }
  if (path === '/contacts' && method === 'POST') return json({ contact: apiContact(upsertContact(loc ?? 'staging', b)) });
  if (path === '/contacts/upsert' && method === 'POST') {
    const had = findContact(loc, { email: b.email as string, phone: b.phone as string });
    return json({ contact: apiContact(upsertContact(loc ?? 'staging', b)), new: !had });
  }
  if ((path === '/contacts' && method === 'GET') || (path === '/contacts/search' && method === 'POST')) {
    const list = [...ghl().contacts.values()].filter((c) => !loc || c.locationId === loc).map(apiContact);
    return json({ contacts: list, total: list.length, meta: { total: list.length } });
  }
  if (parts[0] === 'contacts' && parts[1]) {
    const c = ghl().contacts.get(decodeURIComponent(parts[1]));
    if (!c) return json({ statusCode: 400, message: 'Contact not found', error: 'CONTACT_NOT_FOUND' }, 400);
    if (parts[2] === 'tags') {
      const tags = Array.isArray(b.tags) ? (b.tags as string[]) : [];
      c.tags = method === 'DELETE' ? c.tags.filter((t) => !tags.includes(t)) : [...new Set([...c.tags, ...tags])];
      return json({ tags: c.tags });
    }
    if (parts[2] === 'sms' && method === 'POST') {
      const m = addMessage(c, 'outbound', String(b.message ?? ''));
      return json({ messageId: m.id, conversationId: m.conversationId });
    }
    if (method === 'PUT') {
      if (typeof b.phone === 'string') c.phone = b.phone;
      if (typeof b.email === 'string') c.email = b.email.toLowerCase();
      if (typeof b.dnd === 'boolean') c.dnd = b.dnd;
      const smsDnd = (b.dndSettings as { SMS?: { status?: string } } | undefined)?.SMS?.status;
      if (smsDnd) c.dnd = smsDnd === 'active';
      return json({ contact: apiContact(c), succeded: true });
    }
    if (method === 'DELETE') {
      ghl().contacts.delete(c.id);
      return json({ succeded: true });
    }
    return json({ contact: apiContact(c) });
  }

  // Texting numbers, conversations, messages
  if (parts[0] === 'phone-system' && parts[1] === 'numbers') return json({ numbers: [{ phoneNumber: '+15555550100' }] });
  if (path === '/conversations/search') {
    const contactId = q.get('contactId');
    const list = [...ghl().conversations.values()]
      .filter((c) => (!contactId || c.contactId === contactId) && (!loc || c.locationId === loc))
      .map((c) => ({ id: c.id, contactId: c.contactId, locationId: c.locationId, lastMessageType: 'TYPE_SMS', dateUpdated: c.dateUpdated }));
    return json({ conversations: list, total: list.length });
  }
  if (path === '/conversations' && method === 'POST') {
    const c = ghl().contacts.get(String(b.contactId ?? ''));
    if (!c) return json({ statusCode: 400, message: 'Contact not found' }, 400);
    return json({ success: true, conversation: { id: conversationFor(c).id } });
  }
  if (path === '/conversations/messages' && method === 'POST') {
    const c = ghl().contacts.get(String(b.contactId ?? ''));
    if (!c) return json({ statusCode: 400, message: 'Contact not found' }, 400);
    if (String(b.type ?? '').toLowerCase() === 'email') {
      // An email sent through the venue's CRM (proposals, invoices): to the
      // email outbox, like every other email the test copy sends.
      recordOutbox({ to: c.email ? [c.email] : [], cc: [], bcc: [], subject: String(b.subject ?? ''), html: String(b.html ?? ''), delivered: false });
      return json({ conversationId: conversationFor(c).id, messageId: newId('em'), emailMessageId: newId('em') });
    }
    const m = addMessage(c, 'outbound', String(b.message ?? ''));
    return json({ conversationId: m.conversationId, messageId: m.id, msg: 'Message queued successfully.' });
  }
  if (parts[0] === 'conversations' && parts[2] === 'messages') {
    const id = decodeURIComponent(parts[1]);
    const list = ghl().messages.filter((m) => m.conversationId === id).reverse().map(apiMessage);
    return json({ messages: { messages: list, nextPage: false, lastMessageId: list[list.length - 1]?.id ?? null } });
  }

  // People at the venue who text from the CRM's app
  if (parts[0] === 'users' && parts[1] && method === 'GET') {
    const name = ghl().users?.get(decodeURIComponent(parts[1]));
    if (!name) return json({ statusCode: 404, message: 'User not found' }, 404);
    const [firstName, ...rest] = name.split(' ');
    return json({ id: parts[1], name, firstName, lastName: rest.join(' ') });
  }

  // Pipelines, tokens: harmless defaults
  if (path === '/opportunities/pipelines') return json({ pipelines: [] });
  if (path.startsWith('/opportunities')) return json({ opportunity: { id: newId('op') } });
  if (path === '/oauth/locationToken') return json({ access_token: 'pit-staging-fake', token_type: 'Bearer' });
  console.log(`[staging-ghl] ${method} ${path}: no fake for this, answered {}`);
  return json({});
}

/** Texts the test copy sent or received, newest first (optionally for one phone, since a time). */
export function readFakeTexts(filter: { phone?: string; since?: string } = {}): FakeText[] {
  const phone = digits(filter.phone);
  const contacts = ghl().contacts;
  return [...ghl().messages]
    .reverse()
    .filter((m) => !filter.since || m.dateAdded >= filter.since)
    .map((m) => ({ at: m.dateAdded, direction: m.direction, phone: contacts.get(m.contactId)?.phone ?? null, body: m.body, contactId: m.contactId, locationId: m.locationId }))
    .filter((t) => !phone || digits(t.phone) === phone);
}

/** A couple texts the venue: the reply waits in the fake service, as in GHL, for the app to pick up. */
export function receiveFakeText(fromPhone: string, body: string): { contactId: string; conversationId: string } | null {
  const c = findContact(null, { phone: fromPhone });
  if (!c) return null;
  const m = addMessage(c, 'inbound', body);
  return { contactId: c.id, conversationId: m.conversationId };
}

/**
 * The VENUE side texts a couple from outside StoryVenue, as it can in GHL:
 * a person from the CRM's app (named), or one of the venue's CRM workflows.
 * StoryVenue didn't send it and only learns of it from the text sync.
 */
export function sendFakeVenueText(
  toPhone: string,
  body: string,
  by: { person?: string; workflow?: boolean } = {},
): { contactId: string; conversationId: string; messageId: string } | null {
  const c = findContact(null, { phone: toPhone });
  if (!c) return null;
  let userId: string | undefined;
  if (by.person) {
    const users = (ghl().users ??= new Map());
    userId = [...users.entries()].find(([, name]) => name === by.person)?.[0] ?? newId('us');
    users.set(userId, by.person);
  }
  const m = addMessage(c, 'outbound', body, { source: by.workflow ? 'workflow' : 'app', ...(userId ? { userId } : {}) });
  return { contactId: c.id, conversationId: m.conversationId, messageId: m.id };
}

export function clearFakeGhl(): void {
  store.__stagingGhl = { contacts: new Map(), conversations: new Map(), messages: [], seq: 0 };
}
