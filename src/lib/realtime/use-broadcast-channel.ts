'use client';

/**
 * useBroadcastChannel — subscribes the component to a single broadcast
 * channel and invokes onEvent whenever a matching event arrives.
 *
 * Uses the public anon-key Supabase client. Subscriptions are cheap; this
 * hook handles channel teardown on unmount + channelName change.
 *
 * Events are typed loosely (unknown payload) — the caller is responsible
 * for narrowing.
 */
import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';

type EventCallback = (event: string, payload: unknown) => void;

export function useBroadcastChannel(
  channelName: string | null,
  events: string[],
  onEvent: EventCallback,
): void {
  const callbackRef = useRef<EventCallback>(onEvent);
  callbackRef.current = onEvent;

  useEffect(() => {
    if (!channelName || events.length === 0) return;

    const ch = supabase.channel(channelName, {
      config: { broadcast: { self: false } },
    });

    for (const evt of events) {
      ch.on('broadcast', { event: evt }, (msg: { event: string; payload: unknown }) => {
        try {
          callbackRef.current?.(msg.event, msg.payload);
        } catch (err) {
          console.warn('[realtime] handler threw', channelName, msg.event, err);
        }
      });
    }

    ch.subscribe();

    return () => {
      supabase.removeChannel(ch).catch(() => {});
    };
    // events array compared by serialized form to avoid resubscribing on
    // every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, events.join('|')]);
}
