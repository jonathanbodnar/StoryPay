/**
 * The test copy's outbox: every email it would send, delivered to an approved
 * address or not, kept in memory so the flow tests can check what went out
 * (GET /api/staging/outbox). Holds the latest 3,000. Live site: does nothing.
 */

import { isStaging } from '@/lib/staging';

export interface OutboxEmail {
  at: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
  /** Went to an approved address (STAGING_EMAIL_ALLOWLIST). */
  delivered: boolean;
}

const MAX = 3000;
const store = globalThis as typeof globalThis & { __stagingOutbox?: OutboxEmail[] };

export function recordOutbox(email: Omit<OutboxEmail, 'at'>): void {
  if (!isStaging()) return;
  const box = (store.__stagingOutbox ??= []);
  box.push({ at: new Date().toISOString(), ...email });
  if (box.length > MAX) box.splice(0, box.length - MAX);
}

/** Newest first, optionally only emails to an address and/or sent since a time. */
export function readOutbox(filter: { to?: string; since?: string } = {}): OutboxEmail[] {
  const to = filter.to?.trim().toLowerCase();
  return [...(store.__stagingOutbox ?? [])]
    .reverse()
    .filter((e) => !filter.since || e.at >= filter.since)
    .filter((e) => !to || [...e.to, ...e.cc, ...e.bcc].some((a) => a.toLowerCase().includes(to)));
}

export function clearOutbox(): void {
  store.__stagingOutbox = [];
}
