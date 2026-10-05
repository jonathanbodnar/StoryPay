import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COUPLE_CHAT_SENDER_KINDS, COUPLE_CHAT_VENUE_SENDER_KINDS, showsInCoupleChat, type ThreadMessageForCouple } from '@/lib/couple-chat';

// The couple's Wedding Planner chat (owner's rule, Oct 5 2026): "it should
// just be basic messages back and forth between the venue owner and the
// bride." The venue's and support's view of the same thread holds everything
// about her; hers holds only what she wrote and what a person wrote back.
// Until that day her chat showed every outward message in the thread, so an
// automated "📱 Guide sent via SMS: …" note and the AI's follow-ups read to
// her as messages from her venue.
const message = (over: Partial<ThreadMessageForCouple> = {}): ThreadMessageForCouple =>
  ({ sender_kind: 'owner', visibility: 'external', support_only: false, audience: 'external', ...over });

describe('what a couple sees in their chat with the venue', () => {
  it('her own messages, and replies from a person on the venue’s side', () => {
    for (const sender_kind of ['contact', 'owner', 'team', 'concierge']) {
      expect(showsInCoupleChat(message({ sender_kind })), sender_kind).toBe(true);
    }
  });

  it('nothing automated: not the guide and reminder texts, not the AI’s follow-ups', () => {
    expect(showsInCoupleChat(message({ sender_kind: 'system' }))).toBe(false);
    expect(showsInCoupleChat(message({ sender_kind: 'ai' }))).toBe(false);
    // A kind added later stays out until someone decides she should see it.
    expect(showsInCoupleChat(message({ sender_kind: 'workflow' }))).toBe(false);
    expect(showsInCoupleChat(message({ sender_kind: '' }))).toBe(false);
  });

  it('nothing meant for the venue or support only, whoever wrote it', () => {
    expect(showsInCoupleChat(message({ visibility: 'internal' }))).toBe(false);                             // a note on her
    expect(showsInCoupleChat(message({ sender_kind: 'concierge', support_only: true }))).toBe(false);        // support's own note
    expect(showsInCoupleChat(message({ sender_kind: 'concierge', audience: 'support_only' }))).toBe(false);
    expect(showsInCoupleChat(message({ sender_kind: 'concierge', audience: 'venue_direct' }))).toBe(false);  // venue ↔ concierge
    expect(showsInCoupleChat(message({ sender_kind: 'owner', audience: 'venue_direct', visibility: 'internal' }))).toBe(false);
  });

  it('a row from before messages had an audience is judged on the rest', () => {
    expect(showsInCoupleChat(message({ audience: null }))).toBe(true);
    expect(showsInCoupleChat({ sender_kind: 'contact', visibility: 'external' })).toBe(true);
    expect(showsInCoupleChat({ sender_kind: 'system', visibility: 'external' })).toBe(false);
  });

  it('the people on the venue’s side are exactly the owner, the team and the concierge', () => {
    expect([...COUPLE_CHAT_VENUE_SENDER_KINDS]).toEqual(['owner', 'team', 'concierge']);
    expect([...COUPLE_CHAT_SENDER_KINDS]).toEqual(['contact', 'owner', 'team', 'concierge']);
  });
});

describe('the couple’s routes use that rule', () => {
  const read = (path: string) => readFileSync(join(__dirname, '..', '..', path), 'utf8');

  it('her chat asks the database only for those senders, and checks each row again', () => {
    const chat = read('src/app/api/couple/messages/route.ts');
    expect(chat).toMatch(/\.in\('sender_kind', \[\.\.\.COUPLE_CHAT_SENDER_KINDS\]\)/);
    expect(chat).toContain('showsInCoupleChat(');
    expect(chat).toMatch(/\.eq\('visibility', 'external'\)/);
  });

  it('her unread badge counts only a person’s reply, never an automated text', () => {
    const wedding = read('src/app/api/couple/wedding/route.ts');
    const unread = wedding.slice(wedding.indexOf('async function unreadForBride'), wedding.indexOf('async function loadGuestSummary'));
    expect(unread).toMatch(/\.in\('sender_kind', \[\.\.\.COUPLE_CHAT_VENUE_SENDER_KINDS\]\)/);
    expect(unread).not.toMatch(/\.neq\('sender_kind'/);
  });
});
