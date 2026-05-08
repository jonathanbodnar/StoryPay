'use client';

/**
 * BrideInboxBadgeSync — always-on realtime listener that refreshes the
 * sidebar badge count whenever an inbound bride message arrives.
 *
 * The admin layout only polls /api/admin/support/inbox-count every 60 s, and
 * dispatches storypay:support-count-refresh when the SupportInboxPanel
 * marks a thread read/unread.  That means an inbound bride SMS or email
 * reply would go unnoticed in the badge for up to 60 s.
 *
 * This component subscribes to the shared 'support:bride-inbox' broadcast
 * channel unconditionally (regardless of which tab is active) and triggers
 * a badge refresh the moment an inbound message arrives.
 */
import { useCallback } from 'react';
import { useBroadcastChannel } from '@/lib/realtime/use-broadcast-channel';
import { supportChannels, type BrideMessageEvent } from '@/lib/realtime/channels';

export function BrideInboxBadgeSync() {
  useBroadcastChannel(
    supportChannels.brideInbox(),
    ['message'],
    useCallback((_evt, payload) => {
      const evt = payload as BrideMessageEvent | null;
      if (!evt) return;
      // Only inbound contact replies change the "needs attention" count.
      // Support-only internal notes never affect the badge.
      if (evt.inbound && !evt.supportOnly) {
        window.dispatchEvent(new Event('storypay:support-count-refresh'));
      }
    }, []),
  );

  return null;
}
