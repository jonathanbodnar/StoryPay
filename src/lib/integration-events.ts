/**
 * Integration event dispatcher.
 *
 * Whenever something noteworthy happens in the app (a lead is created, a
 * proposal is signed, a payment is received, etc.) we call
 * `dispatchIntegrationEvent(...)` to fan the event out to every active
 * webhook subscription registered for that venue (Zapier REST Hooks, n8n,
 * custom integrations, etc.).
 *
 * The function is best-effort: it never throws, swallows transport errors,
 * and bumps `fail_count` on the subscription if the target returns non-2xx
 * five times in a row (then auto-disables the sub).
 *
 * Polling triggers (also exposed by `/api/v1/<entity>/recent`) use the same
 * payload shape so a Zap built on Polling can be migrated to Instant
 * transparently.
 */

import { supabaseAdmin } from './supabase';

export type IntegrationEventType =
  | 'lead.created'
  | 'lead.updated'
  | 'contact.created'
  | 'contact.updated'
  | 'tag.added'
  | 'proposal.sent'
  | 'proposal.signed'
  | 'payment.received'
  | 'appointment.booked'
  | 'appointment.cancelled'
  | 'form.submitted';

export interface IntegrationEventPayload {
  /** Stable event identifier (uuid) — Zapier dedupes on this. */
  id: string;
  /** Dotted event name, e.g. `lead.created`. */
  event: IntegrationEventType;
  /** ISO-8601 UTC. */
  created_at: string;
  /** The venue this event belongs to. */
  venue_id: string;
  /** Event-specific body. */
  data: Record<string, unknown>;
}

interface SubscriptionRow {
  id: string;
  target_url: string;
  fail_count: number;
}

const MAX_FAILS = 5;
const TIMEOUT_MS = 8000;

/** Build a stable payload for both REST Hook and polling consumers. */
export function buildIntegrationPayload(
  venueId: string,
  event: IntegrationEventType,
  data: Record<string, unknown>,
  id?: string,
): IntegrationEventPayload {
  return {
    id: id || cryptoRandomId(),
    event,
    created_at: new Date().toISOString(),
    venue_id: venueId,
    data,
  };
}

function cryptoRandomId(): string {
  // Lightweight UUIDv4-ish — runtime/Edge safe; we don't need cryptographic uniqueness here
  // because the event is already protected by the row id in the audit log.
  // Falls back to a timestamp+random combo if `crypto.randomUUID` is unavailable.
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
  } catch {
    /* ignore */
  }
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function postWithTimeout(url: string, body: unknown): Promise<boolean> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'StoryVenue-Webhook/1.0' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Dispatch an event to every active subscription for the venue.
 * Never throws. Returns a summary { fanout, delivered }.
 */
export async function dispatchIntegrationEvent(
  venueId: string,
  event: IntegrationEventType,
  data: Record<string, unknown>,
): Promise<{ fanout: number; delivered: number }> {
  try {
    const payload = buildIntegrationPayload(venueId, event, data);

    const { data: subs } = await supabaseAdmin
      .from('venue_webhook_subscriptions')
      .select('id, target_url, fail_count')
      .eq('venue_id', venueId)
      .eq('event_type', event)
      .eq('active', true);

    const list = (subs || []) as SubscriptionRow[];
    if (list.length === 0) {
      // Still log to audit so the customer can see "we tried but no Zap is listening"
      void supabaseAdmin
        .from('venue_integration_events')
        .insert({ venue_id: venueId, event_type: event, payload: payload as object, fanout: 0, delivered: 0 });
      return { fanout: 0, delivered: 0 };
    }

    let delivered = 0;
    await Promise.all(
      list.map(async (sub) => {
        const ok = await postWithTimeout(sub.target_url, payload);
        if (ok) {
          delivered += 1;
          await supabaseAdmin
            .from('venue_webhook_subscriptions')
            .update({ last_fired_at: new Date().toISOString(), fail_count: 0 })
            .eq('id', sub.id);
        } else {
          const newFails = (sub.fail_count || 0) + 1;
          await supabaseAdmin
            .from('venue_webhook_subscriptions')
            .update({
              fail_count: newFails,
              active: newFails < MAX_FAILS,
            })
            .eq('id', sub.id);
        }
      }),
    );

    void supabaseAdmin
      .from('venue_integration_events')
      .insert({
        venue_id: venueId,
        event_type: event,
        payload: payload as object,
        fanout: list.length,
        delivered,
      });

    return { fanout: list.length, delivered };
  } catch (err) {
    console.error('[integration-events] dispatch failed:', err);
    return { fanout: 0, delivered: 0 };
  }
}
