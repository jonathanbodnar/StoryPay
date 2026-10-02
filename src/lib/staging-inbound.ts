/**
 * The test copy's stand-in for Resend's "received emails" API. A test hands it
 * an email (POST /api/staging/inbound-email), then delivers the
 * email.received webhook as Resend would; when the app fetches the email from
 * api.resend.com/emails/receiving/<id>, the answer comes from here. Kept in
 * memory; live site: never used (lib/staging.ts routes to it only on the test
 * copy).
 */
import { randomUUID } from 'node:crypto';

export interface FakeInboundEmail {
  from: string;
  to: string[];
  cc?: string[];
  reply_to?: string | null;
  subject: string;
  text?: string | null;
  html?: string | null;
  message_id?: string;
  headers?: Record<string, unknown>;
}

const store = globalThis as typeof globalThis & { __stagingInbound?: Map<string, FakeInboundEmail & { message_id: string }> };
const inbox = () => (store.__stagingInbound ??= new Map());

export function storeFakeInboundEmail(email: FakeInboundEmail): string {
  const id = `inb_${randomUUID()}`;
  inbox().set(id, { ...email, message_id: email.message_id ?? `<${id}@test-copy.example.com>` });
  if (inbox().size > 500) inbox().delete(inbox().keys().next().value!);
  return id;
}

/** Answers GET https://api.resend.com/emails/receiving/<id>; null for any other Resend call. */
export function fakeResendReceivingFetch(url: string): Response | null {
  const m = new URL(url).pathname.match(/^\/emails\/receiving\/([^/]+)$/);
  if (!m) return null;
  const id = decodeURIComponent(m[1]);
  const email = inbox().get(id);
  return email ? Response.json({ id, ...email }) : Response.json({ message: 'Email not found' }, { status: 404 });
}
