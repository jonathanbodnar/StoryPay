/**
 * What a couple sees in their Wedding Planner chat with the venue (owner's
 * rule, Oct 5 2026): "just basic messages back and forth between the venue
 * owner and the bride". Her own messages, and replies written by a person on
 * the venue's side: the owner, a team member, or the StoryVenue Concierge
 * replying for the venue.
 *
 * Everything else in the thread is the venue's and support's record of her,
 * not her chat: automated texts and their delivery notes ("📱 Guide sent via
 * SMS: …"), the AI Concierge's follow-ups, texts brought in from the venue's
 * CRM workflows, internal notes, the venue ↔ concierge side channel, stage
 * moves. Until this rule the chat showed every outward message in the
 * thread, automated ones included.
 */

/** People on the venue's side whose replies a couple sees. */
export const COUPLE_CHAT_VENUE_SENDER_KINDS = ['owner', 'team', 'concierge'] as const;

/** Everyone whose messages are in the couple's chat: herself, and those people. */
export const COUPLE_CHAT_SENDER_KINDS = ['contact', ...COUPLE_CHAT_VENUE_SENDER_KINDS] as const;

export interface ThreadMessageForCouple {
  sender_kind: string;
  visibility: string;
  support_only?: boolean | null;
  audience?: string | null;
}

/** Does this thread message belong in the couple's own chat? */
export function showsInCoupleChat(m: ThreadMessageForCouple): boolean {
  if (m.visibility !== 'external' || m.support_only === true) return false;
  if (m.audience != null && m.audience !== 'external') return false;
  return (COUPLE_CHAT_SENDER_KINDS as readonly string[]).includes(m.sender_kind);
}
