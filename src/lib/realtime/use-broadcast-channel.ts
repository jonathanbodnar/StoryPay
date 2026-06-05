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
 *
 * Reconnection: if Supabase Realtime returns CHANNEL_ERROR or TIMED_OUT,
 * the hook automatically resubscribes after 3 seconds. It also resubscribes
 * when the browser tab becomes visible again (handles long-idle sessions).
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

    let disposed = false;
    let currentCh: ReturnType<typeof supabase.channel> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function subscribe() {
      if (disposed) return;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

      const ch = supabase.channel(channelName!, {
        config: { broadcast: { self: false } },
      });
      currentCh = ch;

      for (const evt of events) {
        ch.on('broadcast', { event: evt }, (msg: { event: string; payload: unknown }) => {
          try {
            callbackRef.current?.(msg.event, msg.payload);
          } catch (err) {
            console.warn('[realtime] handler threw', channelName, msg.event, err);
          }
        });
      }

      ch.subscribe((status) => {
        if (disposed) return;
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          supabase.removeChannel(ch).catch(() => {});
          if (currentCh === ch) currentCh = null;
          reconnectTimer = setTimeout(subscribe, 3000);
        }
      });
    }

    subscribe();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Force a fresh subscription when the tab comes back from background
        // to flush any messages missed while the WS was idle/dropped.
        if (currentCh) { supabase.removeChannel(currentCh).catch(() => {}); currentCh = null; }
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        subscribe();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      document.removeEventListener('visibilitychange', handleVisibility);
      if (currentCh) supabase.removeChannel(currentCh).catch(() => {});
    };
    // events array compared by serialized form to avoid resubscribing on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, events.join('|')]);
}

/**
 * Subscribe to multiple broadcast channels with a single shared handler.
 * Useful when a single conversation view needs to listen across siblings
 * (e.g. cross-channel merged thread view subscribing to every sibling
 * thread's channel).
 *
 * Same reconnection semantics as useBroadcastChannel.
 */
export function useBroadcastChannels(
  channelNames: string[],
  events: string[],
  onEvent: EventCallback,
): void {
  const callbackRef = useRef<EventCallback>(onEvent);
  callbackRef.current = onEvent;

  // Stable serialization for the dep array
  const channelsKey = channelNames.slice().sort().join('|');
  const eventsKey = events.join('|');

  useEffect(() => {
    if (channelNames.length === 0 || events.length === 0) return;

    let disposed = false;
    const currentChannels: ReturnType<typeof supabase.channel>[] = [];
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function subscribeAll() {
      if (disposed) return;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      // Clean up any previous channels before resubscribing
      for (const old of currentChannels.splice(0)) {
        supabase.removeChannel(old).catch(() => {});
      }

      for (const name of channelNames) {
        const ch = supabase.channel(name, { config: { broadcast: { self: false } } });
        for (const evt of events) {
          ch.on('broadcast', { event: evt }, (msg: { event: string; payload: unknown }) => {
            try {
              callbackRef.current?.(msg.event, msg.payload);
            } catch (err) {
              console.warn('[realtime] handler threw', name, msg.event, err);
            }
          });
        }
        ch.subscribe((status) => {
          if (disposed) return;
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            // One bad channel triggers a full resubscribe of all siblings
            if (reconnectTimer === null) {
              reconnectTimer = setTimeout(subscribeAll, 3000);
            }
          }
        });
        currentChannels.push(ch);
      }
    }

    subscribeAll();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        subscribeAll();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      document.removeEventListener('visibilitychange', handleVisibility);
      for (const ch of currentChannels) {
        supabase.removeChannel(ch).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelsKey, eventsKey]);
}
