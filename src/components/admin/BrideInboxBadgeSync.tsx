'use client';

/**
 * BrideInboxBadgeSync — always-on realtime listener that refreshes the
 * sidebar "Support inbox" badge count the instant new bride replies, venue
 * support tickets, or Venue Direct activity arrives — regardless of which
 * admin page/tab is currently open.
 *
 * The admin layout only polls /api/admin/support/inbox-count every 60 s, and
 * dispatches storypay:support-count-refresh when the SupportInboxPanel marks
 * a thread read/unread. Without this, any of the three event types below
 * would go unnoticed in the sidebar badge for up to 60 s.
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

  // New/updated Venue Support tickets and new Venue Direct messages both
  // feed into the same sidebar total (see /api/admin/support/inbox-count).
  useBroadcastChannel(
    supportChannels.tickets(),
    ['message', 'status'],
    useCallback(() => {
      window.dispatchEvent(new Event('storypay:support-count-refresh'));
    }, []),
  );
  useBroadcastChannel(
    supportChannels.venueDirectInbox(),
    ['message'],
    useCallback(() => {
      window.dispatchEvent(new Event('storypay:support-count-refresh'));
    }, []),
  );

  return null;
}
