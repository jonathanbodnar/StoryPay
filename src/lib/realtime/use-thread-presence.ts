'use client';

/**
 * useThreadPresence — lightweight "X is viewing this thread" collision
 * indicator built on the existing broadcast-channel infra (no DB table,
 * pure ephemeral realtime). Two responsibilities:
 *
 *   1. Announce that *I* am viewing `threadId` (ping on mount + every 10s,
 *      'leave' on unmount) — via `supabase.channel(...).send(...)` directly,
 *      since useBroadcastChannel is receive-only.
 *   2. Track OTHER agents currently viewing the same thread, expiring an
 *      agent's entry if we haven't heard a ping from them in 15s (covers a
 *      tab crash / lost network without ever sending 'leave').
 */
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useBroadcastChannel } from '@/lib/realtime/use-broadcast-channel';
import { supportChannels, type ThreadPresenceEvent } from '@/lib/realtime/channels';

const PING_INTERVAL_MS = 10_000;
const EXPIRE_MS = 15_000;

export interface PresentAgent {
  agentId:   string;
  agentName: string;
  lastSeen:  number;
}

export function useThreadPresence(
  kind: 'thread' | 'ticket',
  id: string | null,
  self: { agentId: string; agentName: string } | null,
): PresentAgent[] {
  const [others, setOthers] = useState<Record<string, PresentAgent>>({});
  const channelName = id ? supportChannels.presence(kind, id) : null;

  // Reset the "who's here" list whenever we switch threads/tickets. Adjusting
  // state directly during render (rather than in an effect) is the react.dev
  // -recommended pattern for "reset state when a prop changes" — see
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [prevChannelName, setPrevChannelName] = useState(channelName);
  if (channelName !== prevChannelName) {
    setPrevChannelName(channelName);
    setOthers({});
  }

  // Receive pings/leaves from other agents viewing the same thread/ticket.
  useBroadcastChannel(
    channelName,
    ['presence'],
    (_evt, payload) => {
      const p = payload as ThreadPresenceEvent | null;
      if (!p || !self || p.agentId === self.agentId) return;
      setOthers(prev => {
        if (p.kind === 'leave') {
          if (!(p.agentId in prev)) return prev;
          const next = { ...prev };
          delete next[p.agentId];
          return next;
        }
        return { ...prev, [p.agentId]: { agentId: p.agentId, agentName: p.agentName, lastSeen: Date.now() } };
      });
    },
  );

  // Expire stale entries every few seconds.
  useEffect(() => {
    const t = setInterval(() => {
      setOthers(prev => {
        const now = Date.now();
        let changed = false;
        const next: Record<string, PresentAgent> = {};
        for (const [k, v] of Object.entries(prev)) {
          if (now - v.lastSeen <= EXPIRE_MS) next[k] = v;
          else changed = true;
        }
        return changed ? next : prev;
      });
    }, 4000);
    return () => clearInterval(t);
  }, []);

  // Announce our own presence: ping on mount + heartbeat, leave on unmount/switch.
  const selfRef = useRef(self);
  useEffect(() => { selfRef.current = self; }, [self]);
  useEffect(() => {
    if (!channelName || !self) return;
    const ch = supabase.channel(channelName, { config: { broadcast: { self: false } } });
    let subscribed = false;
    const send = (kindEvt: ThreadPresenceEvent['kind']) => {
      if (!subscribed || !selfRef.current) return;
      void ch.send({
        type: 'broadcast',
        event: 'presence',
        payload: { agentId: selfRef.current.agentId, agentName: selfRef.current.agentName, kind: kindEvt } as ThreadPresenceEvent,
      });
    };
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        subscribed = true;
        send('ping');
      }
    });
    const heartbeat = setInterval(() => send('ping'), PING_INTERVAL_MS);
    return () => {
      send('leave');
      clearInterval(heartbeat);
      setTimeout(() => { void supabase.removeChannel(ch); }, 250);
    };
  }, [channelName, self?.agentId, self?.agentName]);

  return Object.values(others).sort((a, b) => a.agentName.localeCompare(b.agentName));
}
