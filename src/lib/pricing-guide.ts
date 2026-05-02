import { supabaseAdmin } from '@/lib/supabase';

/**
 * Returns the venue_pricing_guides.id for a venue, creating an empty row if
 * one doesn't exist yet. Used by the spaces/packages CRUD routes which can
 * legitimately fire before the user has saved any parent-level fields.
 */
export async function getOrCreatePricingGuideId(venueId: string): Promise<string> {
  const { data: existing, error: lookupErr } = await supabaseAdmin
    .from('venue_pricing_guides')
    .select('id')
    .eq('venue_id', venueId)
    .maybeSingle();

  if (lookupErr && lookupErr.code !== 'PGRST116') throw new Error(lookupErr.message);
  if (existing?.id) return existing.id as string;

  const { data: created, error: insertErr } = await supabaseAdmin
    .from('venue_pricing_guides')
    .insert({ venue_id: venueId })
    .select('id')
    .single();

  if (insertErr) throw new Error(insertErr.message);
  return created.id as string;
}

/**
 * Verifies that a child row (space or package) belongs to the given venue.
 * Tolerates either table name. Returns true if the child is owned by the
 * venue, false otherwise. Used by PATCH/DELETE handlers as an authorization
 * gate before mutation.
 */
export async function childBelongsToVenue(
  table: 'venue_pricing_guide_spaces' | 'venue_pricing_guide_packages',
  childId: string,
  venueId: string,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from(table)
    .select('pricing_guide_id, venue_pricing_guides!inner(venue_id)')
    .eq('id', childId)
    .maybeSingle();

  if (error || !data) return false;
  // The joined column is namespaced by Supabase as `venue_pricing_guides.venue_id`.
  // We only need to check that the join row exists with a matching venue_id.
  const joined = (data as unknown as { venue_pricing_guides?: { venue_id?: string } }).venue_pricing_guides;
  return joined?.venue_id === venueId;
}
