/**
 * GET /api/notifications/badge-count?leadsSince=<ISO>
 *
 * Combined "needs attention" total for the native app icon badge — the sum
 * of every scenario that can trigger a native push (new leads, new
 * messages, AI Concierge handoffs). Mirrors the three counts already shown
 * as separate red pills in the dashboard sidebar (src/components/Sidebar.tsx)
 * and bottom tab bar (src/components/MobileTabBar.tsx), just added together.
 *
 * Deliberately excludes the changelog "Updates" badge — that one is
 * informational, not something the owner needs to act on.
 *
 * `leadsSince` mirrors the client-side LEADS_SEEN_KEY baseline (there is no
 * server-persisted "last seen leads" timestamp, same as /api/leads/unread-count).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getVenueId } from '@/lib/auth-helpers';
import { getSessionUser } from '@/lib/session';
import { conversationReaderRef } from '@/lib/conversation-reader';
import { getConversationsUnread, getLeadsUnreadSince, getConciergeUnread } from '@/lib/notification-badge';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const venueId = await getVenueId();
  const user = await getSessionUser();
  if (!venueId || !user) return NextResponse.json({ count: 0 });

  const leadsSince = new URL(req.url).searchParams.get('leadsSince');

  const [conversations, leads, concierge] = await Promise.all([
    getConversationsUnread(venueId, conversationReaderRef(user)).catch(() => 0),
    getLeadsUnreadSince(venueId, leadsSince).catch(() => 0),
    getConciergeUnread(venueId, user.memberId).catch(() => 0),
  ]);

  return NextResponse.json({ count: conversations + leads + concierge });
}
