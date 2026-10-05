/**
 * Texts the VENUE side sent from outside StoryVenue: a person replying from
 * the CRM's phone app, a CRM workflow, another app through the CRM. Until
 * Oct 5 2026 the text sync imported only the couple's texts, so a thread
 * where the owner answered from her phone read as the bride answering
 * herself (White Pine Manor), with no record of what the venue had said.
 *
 * These are the rules for bringing those texts into the thread: which of the
 * texting account's outbound texts StoryVenue already has (so nothing is
 * shown twice), and who to say sent the ones it doesn't. Pure, so the fast
 * checks can hold them still (tests/unit/venue-side-texts.test.ts). The
 * import itself is in lib/ghl-sms-conversations.ts.
 */

/** Where a venue-side text StoryVenue didn't send came from (conversation_messages.sent_via). */
export type SentVia = 'crm_user' | 'crm_workflow' | 'crm_api';

export interface TextOrigin {
  sentVia: SentVia;
  /** How the thread stores it: a person at the venue, or an automated text. */
  senderKind: 'owner' | 'system';
  /** The CRM user who sent it, when a person did. */
  userId: string | null;
}

const AUTOMATION_SOURCES = new Set(['workflow', 'campaign', 'bulk_actions', 'bulk', 'automation', 'trigger']);

/**
 * Who sent an outbound text, as the texting account reports it:
 *  - it names a user: a person at the venue, from the CRM's app (phone or web);
 *  - its source is a workflow/campaign: one of the venue's CRM automations;
 *  - otherwise another app sent it through the CRM.
 */
export function venueSideTextOrigin(msg: Record<string, unknown>): TextOrigin {
  const userId = typeof msg.userId === 'string' && msg.userId.trim() ? msg.userId.trim() : null;
  if (userId) return { sentVia: 'crm_user', senderKind: 'owner', userId };
  const source = String(msg.source ?? '').trim().toLowerCase();
  if (AUTOMATION_SOURCES.has(source)) return { sentVia: 'crm_workflow', senderKind: 'system', userId: null };
  return { sentVia: 'crm_api', senderKind: 'system', userId: null };
}

/** Texts the venue's CRM sent by itself: a workflow, or another app going through it. */
const AUTOMATED_VIA: ReadonlySet<string> = new Set<SentVia>(['crm_workflow', 'crm_api']);

/**
 * Does this message count when working out who spoke last in a thread (is
 * the bride still waiting for an answer)? An automated text brought in from
 * the venue's CRM doesn't: nobody answered her by it. Before these texts were
 * brought in they couldn't take a bride's reply out of the Support Inbox's
 * "Bride replies", and they still can't. A person's text from the CRM app
 * does count: the venue answered.
 */
export function countsAsSpeaking(m: { sent_via?: string | null }): boolean {
  return !AUTOMATED_VIA.has(String(m.sent_via ?? ''));
}

/**
 * The latest message that counts, per thread: who spoke last. Rows in any order.
 */
export function lastSpeakerByThread<T extends { thread_id: string; created_at: string; sent_via?: string | null }>(
  rows: readonly T[],
): Map<string, T> {
  const latest = new Map<string, T>();
  for (const row of rows) {
    if (!countsAsSpeaking(row)) continue;
    const seen = latest.get(row.thread_id);
    if (!seen || Date.parse(row.created_at) > Date.parse(seen.created_at)) latest.set(row.thread_id, row);
  }
  return latest;
}

/**
 * A venue-side text being brought in: is it news, or history? It's news only
 * when nothing in the thread is newer (the owner texted from her phone a
 * moment ago). A text older than the thread's latest message is history being
 * filled in: open inboxes aren't told, so it can't be shown as the last thing
 * said or clear a bride's later reply from "needs a reply". The next time the
 * thread is opened it's there, in its place.
 */
export function isNewsToTheThread(sentAt: string | null | undefined, newestInThread: string | null | undefined): boolean {
  const at = Date.parse(String(sentAt ?? ''));
  const newest = Date.parse(String(newestInThread ?? ''));
  if (!Number.isFinite(newest)) return true;
  // No time on it: it was stored as "now", so it is the newest.
  return !Number.isFinite(at) || at >= newest;
}

/** A text that never reached the couple isn't part of the conversation. */
export function wasNotDelivered(msg: Record<string, unknown>): boolean {
  const status = String(msg.status ?? '').trim().toLowerCase();
  return status === 'failed' || status === 'undelivered' || status === 'rejected';
}

export interface StoredText {
  id: string;
  body: string;
  created_at: string;
  sender_kind: string;
  ghl_message_id: string | null;
}

const words = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** How far apart the two clocks may be for the same text (StoryVenue's send, the CRM's record of it). */
export const SAME_TEXT_WITHIN_MS = 20 * 60_000;

/**
 * The thread's own record of this outbound text, if StoryVenue sent it.
 * StoryVenue's sends carry no CRM id, so they are found by their words, sent
 * within twenty minutes: the same text; or one stored as a note around it
 * ("📱 Guide sent via SMS: Hi Summer! …"); or the same opening (links get
 * shortened on the way out). Only rows that don't already belong to another
 * CRM text are candidates, so two identical automated texts each find their own.
 */
export function ownRecordOf(body: string, sentAt: string | null | undefined, candidates: readonly StoredText[]): StoredText | null {
  const text = words(body);
  if (!text) return null;
  const at = Date.parse(String(sentAt ?? ''));
  const opening = text.slice(0, 60);
  let best: StoredText | null = null;
  let bestGap = Infinity;
  for (const row of candidates) {
    if (row.sender_kind === 'contact' || row.ghl_message_id) continue;
    const gap = Number.isFinite(at) ? Math.abs(Date.parse(row.created_at) - at) : 0;
    if (!(gap <= SAME_TEXT_WITHIN_MS)) continue;
    const mine = words(row.body);
    // Only a text of some length can be found INSIDE another: "Ok!" is in
    // half the texts ever sent, and a person's short reply must not be taken
    // for part of an automated one.
    const same = mine === text
      || (text.length >= 24 && mine.includes(text))
      || (mine.length >= 24 && text.includes(mine))
      || (opening.length >= 40 && mine.includes(opening));
    if (same && gap < bestGap) {
      best = row;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * What the thread says about who sent a message that came in this way: to
 * support ("the venue's texting app") or to the venue itself ("your").
 */
export function sentViaLabel(sentVia: string | null | undefined, sentByName?: string | null, reader: 'support' | 'venue' = 'support'): string | null {
  const name = (sentByName ?? '').trim();
  const venue = reader === 'venue';
  if (sentVia === 'crm_user') {
    if (name) return `${name} · from ${venue ? 'your' : 'the venue’s'} texting app`;
    return venue ? 'Sent from your texting app' : 'Venue · from their texting app';
  }
  if (sentVia === 'crm_workflow') return venue ? 'Automation · your CRM workflow' : 'Automation · venue’s CRM workflow';
  if (sentVia === 'crm_api') return venue ? 'Automated text · sent through your CRM' : 'Automated text · sent through the venue’s CRM';
  return null;
}
