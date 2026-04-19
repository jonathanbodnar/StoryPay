import type { SessionUser } from '@/lib/session';

/** Stable key for read state: one owner row per venue, or team member id. */
export function conversationReaderRef(user: SessionUser): string {
  if (user.memberId) return `m:${user.memberId}`;
  return 'owner';
}
