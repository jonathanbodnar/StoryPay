import { supabaseAdmin } from './supabase';

/**
 * Server-side session revocation ("force logout").
 *
 * Stamps session_invalidated_before = now on the account. The proxy middleware
 * strips any tenant cookie whose signed issue-time (iat) predates that instant,
 * so every existing session is invalidated. Because the middleware caches this
 * value ~60s, revocation propagates within roughly a minute.
 *
 * Call BEFORE issuing a fresh signed cookie (e.g. after a password reset): the
 * new cookie's iat is >= now, so the current session survives while all others
 * are logged out.
 */
export async function revokeVenueSessions(venueId: string): Promise<void> {
  if (!venueId) return;
  await supabaseAdmin
    .from('venues')
    .update({ session_invalidated_before: new Date().toISOString() })
    .eq('id', venueId);
}

export async function revokeMemberSessions(memberId: string): Promise<void> {
  if (!memberId) return;
  await supabaseAdmin
    .from('venue_team_members')
    .update({ session_invalidated_before: new Date().toISOString() })
    .eq('id', memberId);
}
