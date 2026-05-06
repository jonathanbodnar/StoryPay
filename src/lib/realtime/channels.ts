/**
 * Centralized channel naming + payload types for Realtime broadcasts.
 *
 * The support inbox uses Supabase Realtime *Broadcast* (not postgres_changes)
 * because:
 *  - The dashboard uses cookie auth, not Supabase auth — so the browser only
 *    has the anon role at the DB layer. Granting anon SELECT on conversation
 *    tables would leak every venue's messages.
 *  - Broadcast doesn't need DB access — server-side code fans out events on
 *    named channels and clients subscribe by name.
 *
 * Channel scheme:
 *
 *   support:bride-inbox            — admin: every bride reply, across venues
 *   support:thread:<threadId>      — admin: messages for a specific bride thread
 *
 *   support:tickets                — admin: ticket activity across all venues
 *   support:ticket:<ticketId>      — admin: messages for a specific ticket
 *
 *   venue:<venueId>:tickets        — venue: ticket activity for that venue
 *   venue:<venueId>:ticket:<ticketId>  — venue: messages for a specific ticket
 *
 *   venue:<venueId>:thread:<threadId>  — venue conversations: messages for a
 *                                          specific bride thread (so a support
 *                                          reply on behalf of the venue shows
 *                                          up live in the venue's own inbox).
 */

export const supportChannels = {
  brideInbox:    () => 'support:bride-inbox',
  brideThread:   (threadId: string) => `support:thread:${threadId}`,
  tickets:       () => 'support:tickets',
  ticket:        (ticketId: string) => `support:ticket:${ticketId}`,
  venueTickets:  (venueId: string) => `venue:${venueId}:tickets`,
  venueTicket:   (venueId: string, ticketId: string) => `venue:${venueId}:ticket:${ticketId}`,
  venueThread:   (venueId: string, threadId: string) => `venue:${venueId}:thread:${threadId}`,
} as const;

// ─── Bride conversation events ──────────────────────────────────────────────

export interface BrideMessageEvent {
  /** Whether this update should put the thread back in the "needs attention"
   *  inbox (true for inbound contact replies) or remove it (true for any
   *  outbound reply, since it answers the bride). */
  inbound:               boolean;
  threadId:              string;
  venueId:               string;
  venueCustomerId:       string;
  messageId:             string;
  body:                  string;
  channel:               'sms' | 'email';
  senderKind:            string;
  sentByVenueSupport:    boolean;
  supportAgentId:        string | null;
  createdAt:             string;
  /** True for support-team-only internal notes (visible only to admin/support).
   *  When true, the inbox list MUST NOT bump/drop on this event because a note
   *  doesn't change the bride's "needs attention" status. */
  supportOnly?:          boolean;
  /** Optional list of support_team_members.id mentioned in a note. */
  mentionedSupportUserIds?: string[];
}

// ─── Support ticket events ──────────────────────────────────────────────────

export interface TicketMessageEvent {
  ticketId:      string;
  venueId:       string;
  messageId:     string;
  senderType:    'venue' | 'support';
  body:          string;
  createdAt:     string;
  /** Status of the ticket *after* this message was inserted (server bumps
   *  status on reply: support → 'pending', venue → 'open'). */
  status:        'open' | 'pending' | 'closed';
}

export interface TicketStatusEvent {
  ticketId:               string;
  venueId:                string;
  status:                 'open' | 'pending' | 'closed';
  priority:               'low' | 'normal' | 'high';
  assignedSupportUserId:  string | null;
}

/** Fired on both bride-thread and venueThread channels when a pipeline stage changes. */
export interface StageChangedEvent {
  threadId:   string;
  venueId:    string;
  vcId:       string;
  stageId:    string;
  stageName:  string;
  stageColor: string | null;
  pipelineId: string;
  /** 'support' = admin changed it, 'venue' = venue changed it */
  source:     'support' | 'venue';
}

/** Fired when tags on a contact's lead(s) change (added or removed). */
export interface TagsChangedEvent {
  threadId:    string;
  venueId:     string;
  vcId:        string;
  /** Full set of currently-applied marketing_tags.id values (deduped across
   *  any duplicate leads sharing this contact's email/phone). The receiver
   *  should replace its applied_tag_ids with this list, not merge it. */
  appliedTagIds: string[];
  source:      'support' | 'venue';
}
