/**
 * Server-side helpers for broadcasting Realtime events to subscribed UIs.
 *
 * Uses the service-role supabaseAdmin client. Each helper builds a fresh
 * channel handle (Supabase channels are cheap), sends the event, and tears
 * the handle down — fire-and-forget semantics.
 *
 * Failures are logged but never thrown: realtime is a UX nicety, not a
 * correctness requirement.
 */
import { supabaseAdmin } from '@/lib/supabase';
import {
  supportChannels,
  type BrideMessageEvent,
  type TicketMessageEvent,
  type TicketStatusEvent,
  type StageChangedEvent,
} from './channels';

async function send(channelName: string, event: string, payload: unknown): Promise<void> {
  try {
    const ch = supabaseAdmin.channel(channelName, { config: { broadcast: { ack: false } } });
    await new Promise<void>((resolve) => {
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          ch.send({ type: 'broadcast', event, payload })
            .catch(() => {})
            .finally(() => {
              supabaseAdmin.removeChannel(ch).catch(() => {});
              resolve();
            });
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          supabaseAdmin.removeChannel(ch).catch(() => {});
          resolve();
        }
      });
    });
  } catch (err) {
    console.warn('[realtime/broadcast]', channelName, event, err);
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
