import { supabaseAdmin } from '@/lib/supabase';

/**
 * Does another account already sign in with this email?
 *
 * Sign-in finds ONE account by its email: a venue owner first, then a team
 * member. Two accounts with the same address means one of them can't get in
 * (two team members with it: neither can, by password). So an address someone
 * else signs in with is refused when a person changes their own. Until Oct 7
 * 2026 an owner's change was checked against other venues only, and a team
 * member's change against nothing.
 */
export async function signInEmailTaken(email: string, mine: { venueId?: string; memberId?: string }): Promise<boolean> {
  const address = email.trim().toLowerCase();
  if (!address) return false;
  // ilike reads _ and % as "any character": an address is matched as written.
  const exactly = address.replace(/[\\%_]/g, (c) => `\\${c}`);

  let venues = supabaseAdmin.from('venues').select('id').ilike('email', exactly).limit(1);
  if (mine.venueId) venues = venues.neq('id', mine.venueId);
  let members = supabaseAdmin.from('venue_team_members').select('id').ilike('email', exactly).limit(1);
  if (mine.memberId) members = members.neq('id', mine.memberId);

  const [v, m] = await Promise.all([venues, members]);
  return Boolean(v.data?.length) || Boolean(m.data?.length);
}
