'use client';

/**
 * GuideViewTracker — fires once on mount to log the guide view as a system
 * message in the contact's conversation thread.  Uses a POST to a lightweight
 * server-action API so no credentials are exposed client-side.
 *
 * Rendered inside the (server) GuidePage and receives venueId + leadId as
 * props, both of which are public values already embedded in the URL.
 */
import { useEffect } from 'react';

interface Props {
  venueId: string;
  leadId: string;
}

export function GuideViewTracker({ venueId, leadId }: Props) {
  useEffect(() => {
    // Fire-and-forget — if it fails, the view just isn't tracked, no UX impact
    fetch(`/api/public/venue/${encodeURIComponent(venueId)}/guide-view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId }),
    }).catch(() => {});
  }, [venueId, leadId]);

  return null;
}
