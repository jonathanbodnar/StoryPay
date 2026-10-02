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
  forgetSessionRow('venues', venueId);
}

export async function revokeMemberSessions(memberId: string): Promise<void> {
  if (!memberId) return;
  await supabaseAdmin
    .from('venue_team_members')
    .update({ session_invalidated_before: new Date().toISOString() })
    .eq('id', memberId);
  forgetSessionRow('venue_team_members', memberId);
}

/**
 * Drop the proxy's cached copy of an account's session row (src/proxy.ts keeps
 * it ~60s, on globalThis) so a revocation, suspension or restore applies at
 * once on this server rather than within the minute.
 */
export function forgetSessionRow(table: 'venues' | 'venue_team_members', id: string): void {
  (globalThis as { __sessionRowCache?: Map<string, unknown> }).__sessionRowCache?.delete(`${table}:${id}`);
}
