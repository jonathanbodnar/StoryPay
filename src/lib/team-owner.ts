import { supabaseAdmin } from '@/lib/supabase';

/**
 * Is this id the venue's OWNER rather than a team member?
 *
 * The Team page shows two different kinds of row. Real team members are rows in
 * `venue_team_members`. The owner is SYNTHESISED from the venues row — the team
 * list (GET /api/team) prepends `{ id: venues.owner_id, role: 'owner', ... }`
 * because the owner's account (password_hash, phone, email, owner_first_name,
 * owner_last_name) lives on `venues`, not in `venue_team_members`.
 *
 * Any endpoint that looks a team member up by id must therefore handle this case.
 * An update aimed only at `venue_team_members` matches zero rows for the owner,
 * and `.single()` then fails with PostgREST's raw "Cannot coerce the result to a
 * single JSON object" — a message that means nothing to a venue owner.
 */
export async function isVenueOwnerId(venueId: string, id: string): Promise<boolean> {
  if (!venueId || !id) return false;
  const { data } = await supabaseAdmin
    .from('venues')
    .select('owner_id')
    .eq('id', venueId)
    .maybeSingle();
  const ownerId = (data as { owner_id?: string | null } | null)?.owner_id ?? null;
  return !!ownerId && ownerId === id;
}

/** Copy for actions that only make sense for invited/team rows, not the owner. */
export const OWNER_NOT_A_TEAM_MEMBER =
  'This is the venue owner, so this action does not apply. Owner details are managed in Settings → General.';
