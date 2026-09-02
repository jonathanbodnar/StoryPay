'use client';

/**
 * useVenueConciergeRealtime — one managed Supabase channel per venue that
 * powers the "feels live" bits of the Venue Concierge thread:
 *
 *   1. New-message broadcasts (server → clients) so both the venue page and the
 *      admin panel append/refresh the moment either side posts.
 *   2. Ephemeral typing indicator (client → clients) — call `notifyTyping()`
 *      on keystrokes; the other side sees `otherTyping` flip on/off.
 *   3. Presence — each side `.track()`s itself; `otherOnline` is true whenever
 *      the counterparty is on the same thread.
 *
 * All ephemeral (no DB writes). Best-effort — realtime is a UX nicety.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { supportChannels, type VenueConciergeMessageEvent, type VenueConciergeTypingEvent } from '@/lib/realtime/channels';

type Side = 'venue' | 'concierge';

const TYPING_EXPIRE_MS = 4000;

export function useVenueConciergeRealtime(opts: {
  venueId: string | null;
  side: Side;
  self: { id: string; name: string } | null;
  onMessage: (evt: VenueConciergeMessageEvent) => void;
}): { otherOnline: boolean; otherTyping: boolean; notifyTyping: () => void } {
  const { venueId, side, self } = opts;
  const [otherOnline, setOtherOnline] = useState(false);
  const [otherTyping, setOtherTyping] = useState(false);

  const onMessageRef = useRef(opts.onMessage);
  onMessageRef.current = opts.onMessage;
  const selfRef = useRef(self);
  selfRef.current = self;

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const subscribedRef = useRef(false);
  const recvExpireTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendOffTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentTypingAt = useRef(0);

  const channelName = venueId ? supportChannels.venueConcierge(venueId) : null;

  useEffect(() => {
    if (!channelName || !self) return;
    let disposed = false;
    subscribedRef.current = false;

    const ch = supabase.channel(channelName, {
      config: { broadcast: { self: false }, presence: { key: self.id } },
    });
    channelRef.current = ch;

    ch.on('broadcast', { event: 'message' }, (msg: { payload: unknown }) => {
      const p = msg.payload as VenueConciergeMessageEvent | null;
      if (!p) return;
      try { onMessageRef.current?.(p); } catch { /* noop */ }
    });

    ch.on('broadcast', { event: 'typing' }, (msg: { payload: unknown }) => {
      const p = msg.payload as VenueConciergeTypingEvent | null;
      if (!p || p.side === side) return;
      setOtherTyping(p.typing);
      if (recvExpireTimer.current) clearTimeout(recvExpireTimer.current);
      if (p.typing) {
        recvExpireTimer.current = setTimeout(() => setOtherTyping(false), TYPING_EXPIRE_MS);
      }
    });

    const recomputePresence = () => {
      try {
        const state = ch.presenceState() as Record<string, Array<{ side?: string }>>;
        let online = false;
        for (const entries of Object.values(state)) {
          for (const e of entries) {
            if (e?.side && e.side !== side) { online = true; break; }
          }
          if (online) break;
        }
        setOtherOnline(online);
      } catch { /* noop */ }
    };
    ch.on('presence', { event: 'sync' }, recomputePresence);
    ch.on('presence', { event: 'join' }, recomputePresence);
    ch.on('presence', { event: 'leave' }, recomputePresence);

    ch.subscribe((status) => {
      if (disposed) return;
      if (status === 'SUBSCRIBED') {
        subscribedRef.current = true;
        const s = selfRef.current;
        if (s) void ch.track({ side, id: s.id, name: s.name });
      }
    });

    return () => {
      disposed = true;
      subscribedRef.current = false;
      if (recvExpireTimer.current) clearTimeout(recvExpireTimer.current);
      if (sendOffTimer.current) clearTimeout(sendOffTimer.current);
      void ch.untrack().catch(() => {});
      setTimeout(() => { void supabase.removeChannel(ch); }, 200);
      if (channelRef.current === ch) channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, side, self?.id, self?.name]);

  const sendTyping = useCallback((typing: boolean) => {
    const ch = channelRef.current;
    const s = selfRef.current;
    if (!ch || !subscribedRef.current || !s) return;
    void ch.send({
      type: 'broadcast',
      event: 'typing',
      payload: { side, authorName: s.name, typing } as VenueConciergeTypingEvent,
    });
  }, [side]);

  // Throttled "I'm typing" ping — safe to call on every keystroke.
  const notifyTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastSentTypingAt.current > 1500) {
      lastSentTypingAt.current = now;
      sendTyping(true);
    }
    if (sendOffTimer.current) clearTimeout(sendOffTimer.current);
    sendOffTimer.current = setTimeout(() => sendTyping(false), 2500);
  }, [sendTyping]);

  return { otherOnline, otherTyping, notifyTyping };
}
