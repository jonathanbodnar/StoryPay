/**
 * What a browser is told about a team member.
 *
 * Until Oct 7 2026 the team routes sent each member's whole row: the team list
 * (which any signed-in team member can ask for: the calendar, the Lead Inbox
 * and Conversations all read it) carried every teammate's `invite_token` and
 * `password_hash`. The invite token signs its member in: it is their emailed
 * link, and their password until they set one. So a Member could have signed
 * in as an Admin.
 *
 * Only what the screens show leaves the server. Anything added to the table
 * later stays behind until it is named here.
 */
export const TEAM_MEMBER_FIELDS = [
  'id', 'venue_id', 'name', 'first_name', 'last_name', 'email', 'phone', 'role', 'status',
  'avatar_url', 'invited_at', 'created_at', 'hide_revenue',
] as const;

export function teamMemberForBrowser(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of TEAM_MEMBER_FIELDS) {
    if (row[field] !== undefined) out[field] = row[field];
  }
  return out;
}
