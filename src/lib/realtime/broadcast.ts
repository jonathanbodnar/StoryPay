/**
 * Server-side helpers for broadcasting Realtime events to subscribed UIs.
 *
 * Uses Supabase Realtime's HTTP broadcast endpoint
 * (POST /realtime/v1/api/broadcast) instead of a WebSocket channel.
 *
 * Why HTTP instead of WebSocket:
 *   The supabaseAdmin singleton's Realtime WebSocket goes idle between
 *   requests on Railway (persistent Node.js server). When ch.subscribe()
 *   is called the connection is often stale → CHANNEL_ERROR fires →
 *   the message is silently dropped before it reaches any client. The
 *   HTTP broadcast endpoint is a stateless POST that the Supabase Realtime
 *   server fans out to all WS subscribers on that channel, so it works
 *   regardless of the server's own WebSocket state.
 *
 * Failures are logged but never thrown: realtime is a UX nicety, not a
 * correctness requirement.
 */
import {
  supportChannels,
  type BrideMessageEvent,
  type TicketMessageEvent,
  type TicketStatusEvent,
  type StageChangedEvent,
  type TagsChangedEvent,
  type VenueDirectInboxEvent,
} from './channels';

// ─── HTTP broadcast ─────────────────────────────────────────────────────────

interface BroadcastMessage {
  /** Must be prefixed with "realtime:" — this is the internal channel name. */
  topic:   string;
  event:   'broadcast';
  payload: {
    type:    'broadcast';
    event:   string;
    payload: unknown;
  };
}

async function send(channelName: string, event: string, payload: unknown): Promise<void> {
  const supabaseUrl   = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey    = process.env.SUPABASE_SERVICE_ROLE_KEY
                     || process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.warn('[realtime/broadcast] Missing Supabase env vars — skipping broadcast');
    return;
  }

  const message: BroadcastMessage = {
    topic:   `realtime:${channelName}`,
    event:   'broadcast',
    payload: { type: 'broadcast', event, payload },
  };

  try {
    const res = await fetch(`${supabaseUrl}/realtime/v1/api/broadcast`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ messages: [message] }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`[realtime/broadcast] ${channelName}:${event} → HTTP ${res.status}`, text);
    }
  } catch (err) {
    console.warn('[realtime/broadcast] fetch failed', channelName, event, err);
  }
}

// ─── Bride conversations ───────────────────────────────────────────────────

export async function broadcastBrideMessage(evt: BrideMessageEvent): Promise<void> {
  // Fan out to admin inbox + active thread + venue's conversations view.
  await Promise.allSettled([
    send(supportChannels.brideInbox(),                                'message', evt),
    send(supportChannels.brideThread(evt.threadId),                   'message', evt),
    send(supportChannels.venueThread(evt.venueId, evt.threadId),      'message', evt),
  ]);
}

/**
 * Like broadcastBrideMessage but only fans out to admin-side channels.
 * Used for support_only internal notes that the venue must NOT receive.
 */
export async function broadcastBrideMessageAdminOnly(evt: BrideMessageEvent): Promise<void> {
  await Promise.allSettled([
    send(supportChannels.brideInbox(),                                'message', evt),
    send(supportChannels.brideThread(evt.threadId),                   'message', evt),
  ]);
}

// ─── Support tickets ───────────────────────────────────────────────────────

export async function broadcastTicketMessage(evt: TicketMessageEvent): Promise<void> {
  await Promise.allSettled([
    send(supportChannels.tickets(),                                   'message', evt),
    send(supportChannels.ticket(evt.ticketId),                        'message', evt),
    send(supportChannels.venueTickets(evt.venueId),                   'message', evt),
    send(supportChannels.venueTicket(evt.venueId, evt.ticketId),      'message', evt),
  ]);
}

export async function broadcastTicketStatus(evt: TicketStatusEvent): Promise<void> {
  await Promise.allSettled([
    send(supportChannels.tickets(),                                   'status',  evt),
    send(supportChannels.ticket(evt.ticketId),                        'status',  evt),
    send(supportChannels.venueTickets(evt.venueId),                   'status',  evt),
    send(supportChannels.venueTicket(evt.venueId, evt.ticketId),      'status',  evt),
  ]);
}

/** Broadcast a pipeline stage change on both admin and venue channels so both sides update live. */
export async function broadcastStageChanged(evt: StageChangedEvent): Promise<void> {
  await Promise.allSettled([
    send(supportChannels.brideThread(evt.threadId),                       'stage_changed', evt),
    send(supportChannels.venueThread(evt.venueId, evt.threadId),          'stage_changed', evt),
  ]);
}

/** Broadcast a venue-direct inbox update so VenueDirectInboxView refreshes
 *  immediately instead of waiting for the 30-second poll cycle. */
export async function broadcastVenueDirectInboxUpdate(evt: VenueDirectInboxEvent): Promise<void> {
  await send(supportChannels.venueDirectInbox(), 'message', evt);
}

/** Broadcast a tag change so the admin context sidebar reflects it without a refresh. */
export async function broadcastTagsChanged(evt: TagsChangedEvent): Promise<void> {
  await Promise.allSettled([
    send(supportChannels.brideThread(evt.threadId),                       'tags_changed', evt),
    send(supportChannels.venueThread(evt.venueId, evt.threadId),          'tags_changed', evt),
  ]);
}
