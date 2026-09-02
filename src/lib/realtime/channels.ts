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

import type { SupportAttachment } from '@/lib/support/support-attachments-bucket';

export const supportChannels = {
  brideInbox:       () => 'support:bride-inbox',
  brideThread:      (threadId: string) => `support:thread:${threadId}`,
  tickets:          () => 'support:tickets',
  ticket:           (ticketId: string) => `support:ticket:${ticketId}`,
  venueTickets:     (venueId: string) => `venue:${venueId}:tickets`,
  venueTicket:      (venueId: string, ticketId: string) => `venue:${venueId}:ticket:${ticketId}`,
  venueThread:      (venueId: string, threadId: string) => `venue:${venueId}:thread:${threadId}`,
  /** Fired whenever any venue-direct message is sent or received so the
   *  VenueDirectInboxView updates instantly instead of waiting for 30s poll. */
  venueDirectInbox: () => 'support:venue-direct-inbox',
  /** Fired whenever a new error is logged platform-wide so the super-admin
   *  Error Log tab + sidebar badge update live (no refresh). */
  adminErrors:      () => 'admin:error-feed',
  /** Fired whenever a new lead is created for a venue so the Lead Inbox badge
   *  (sidebar + mobile tab bar) updates instantly instead of polling. */
  venueLeads:       (venueId: string) => `venue:${venueId}:leads`,
  /** Fired the instant a listing_events row lands with usable coordinates,
   *  so the Live Visitor Map on the Listing Analytics dashboard plots the
   *  dot the moment someone lands on the venue's page — no 30s poll wait. */
  venueVisitorMap:  (venueId: string) => `venue:${venueId}:visitor-map`,
  /**
   * Venue-wide conversations channel — fired on every new message across ALL
   * threads for the venue. The conversations page subscribes here so the
   * sidebar thread list updates (unread badge, preview, timestamp, sort order)
   * even when the message arrived in a thread other than the one currently open.
   */
  venueConversations: (venueId: string) => `venue:${venueId}:conversations`,
  /** Ephemeral "X is viewing this thread/ticket" presence — pure broadcast,
   *  no DB table. Scoped per thread/ticket so only agents looking at the
   *  same conversation see each other. */
  presence: (kind: 'thread' | 'ticket', id: string) => `presence:${kind}:${id}`,
  /** Fired whenever a concierge <-> venue owner/team direct message is sent
   *  or an SMS reply is synced in, so the Private Clients panel's message
   *  history and "needs reply" state update live instead of only on open. */
  privateClients: () => 'support:private-clients',
  /** Venue Concierge relationship thread (one per venue). Carries new-message
   *  broadcasts (server), plus ephemeral typing + Supabase presence so both the
   *  venue page and the admin panel feel live. */
  venueConcierge: (venueId: string) => `venue:${venueId}:concierge`,
  /** Global admin fan-out — fires on ANY venue → concierge message so the
   *  Support Inbox "Venue Concierge" tab badge + list update live regardless of
   *  which venue is open. Mirrors venueDirectInbox(). */
  venueConciergeInbox: () => 'support:venue-concierge-inbox',
} as const;

/** Fired when either side posts to the Venue Concierge thread. */
export interface VenueConciergeMessageEvent {
  venueId:    string;
  /** 'inbound' = venue → concierge, 'outbound' = concierge → venue */
  direction:  'inbound' | 'outbound';
  messageId:  string;
  body:       string;
  authorName: string;
  createdAt:  string;
}

/** Ephemeral typing broadcast on the venueConcierge channel. */
export interface VenueConciergeTypingEvent {
  /** 'venue' = venue owner/team is typing, 'concierge' = concierge is typing */
  side:      'venue' | 'concierge';
  authorName: string;
  typing:    boolean;
}

/** Fired when a new lead is created so the Lead Inbox badge updates live. */
export interface NewLeadEvent {
  venueId:   string;
  leadId:    string;
  source:    string;
  createdAt: string;
}

/** Fired the instant a visitor's browser reports a trackable event with
 *  resolved coordinates (page view, heartbeat, etc.) — lets the Live
 *  Visitor Map plot/refresh their dot immediately instead of waiting for
 *  the next 30s poll. `flag`/`label` are pre-computed server-side (from
 *  the same helpers the poll endpoint uses) so the optimistic dot and the
 *  next polled one render identically. */
export interface VisitorPingEvent {
  venueId:    string;
  sessionId:  string;
  lat:        number;
  lng:        number;
  city:       string | null;
  region:     string | null;
  country:    string | null;
  flag:       string;
  label:      string;
  live:       boolean;
}

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
  /** True when the outbound message is a Venue Direct message (concierge → venue
   *  side channel, invisible to the bride). The bride inbox list MUST NOT drop
   *  or bump the thread on this event — the bride still needs a reply. */
  venueDirectMessage?:   boolean;
  /** Optional list of support_team_members.id mentioned in a note. */
  mentionedSupportUserIds?: string[];
  /** Attachments on the message, so live-appended bubbles render them without
   *  waiting for a refetch. */
  attachments?:          SupportAttachment[] | null;
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
  /** Attachments on the message, so live-appended bubbles render them without
   *  waiting for a refetch. */
  attachments?:  SupportAttachment[] | null;
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

/** Fired whenever a venue-direct message is sent (concierge → venue) or
 *  received (venue → concierge). The VenueDirectInboxView subscribes to
 *  this channel and refreshes its list on any event. */
export interface VenueDirectInboxEvent {
  threadId:    string;
  venueId:     string;
  /** 'outbound' = concierge sent to venue, 'inbound' = venue replied */
  direction:   'outbound' | 'inbound';
}

/** Fired when a new error is logged so the admin Error Log feed + badge
 *  update in real time. Payload is intentionally small — the panel refetches
 *  detail rows itself; this just signals "something new arrived". */
export interface ErrorLoggedEvent {
  id:         string;
  level:      'info' | 'warning' | 'error' | 'critical';
  source:     string;
  category:   string | null;
  message:    string;
  venueId:    string | null;
  /** True when this event bumped an existing fingerprint rather than inserting
   *  a brand-new row (so the feed can choose to re-sort vs prepend). */
  deduped:    boolean;
  createdAt:  string;
}

/**
 * Fired on venue:{id}:conversations when a lead's AI state changes so the
 * AI Concierge pill in the conversations page updates live without a refresh.
 */
export interface AiStateChangedEvent {
  leadId:      string;
  venueId:     string;
  newState:    string;
  /** ISO timestamp for ai_next_send_at — null when AI is off. */
  nextSendAt:  string | null;
}

/** Fired when tags on a contact's lead(s) change (added or removed). */
/**
 * Ephemeral presence broadcast — "X is viewing this thread/ticket". Sent on
 * `supportChannels.presence(kind, id)`. Never persisted; receivers should
 * expire an agent's pill after ~15s without a fresh 'ping', and senders
 * should fire a 'leave' on unmount so other agents clear it immediately.
 */
export interface ThreadPresenceEvent {
  agentId:   string;
  agentName: string;
  /** 'ping' = still viewing (sent on mount + heartbeat). 'leave' = closed/navigated away. */
  kind:      'ping' | 'leave';
}

/** Fired on support:private-clients whenever a concierge <-> venue
 *  owner/team direct message is sent or an SMS reply is synced in from
 *  GHL. Payload is intentionally small (like VenueDirectInboxEvent) — the
 *  panel just refetches the venue's message history on any event. */
export interface PrivateClientMessageEvent {
  venueId:   string;
  /** 'outbound' = concierge sent it, 'inbound' = owner/team member replied */
  direction: 'outbound' | 'inbound';
  channel:   'email' | 'sms';
}

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
