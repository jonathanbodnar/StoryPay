import { supabaseAdmin } from '@/lib/supabase';

/**
 * Resolve (creating if needed) the venue's "Listing Lead Form" — the marketing
 * form that lead-capture pathways fire their `form submitted` trigger against.
 *
 * Shared deliberately: two different entry points now capture leads (the venue
 * listing page and LeadFinder's forwarded-email path) and both must hand the
 * workflow engine the SAME form id. Two copies of this lookup would eventually
 * diverge and put captured leads down a different automation path than form
 * leads, which is exactly the inconsistency we are trying to avoid.
 */
export async function ensureListingForm(venueId: string): Promise<string | null> {
  try {
    // Try the is_listing_form flag first (migration 068).
    const byFlag = await supabaseAdmin
      .from('marketing_forms')
      .select('id')
      .eq('venue_id', venueId)
      .eq('is_listing_form', true)
      .maybeSingle();

    if (!byFlag.error && byFlag.data) return byFlag.data.id as string;

    // If the column doesn't exist yet, fall back to matching by name.
    const colMissing = byFlag.error && /column.*is_listing_form/i.test(byFlag.error.message);
    if (colMissing || byFlag.error) {
      // Fallback: find or create by name only.
      const byName = await supabaseAdmin
        .from('marketing_forms')
        .select('id')
        .eq('venue_id', venueId)
        .ilike('name', 'Listing Lead Form')
        .maybeSingle();
      if (byName.data) return byName.data.id as string;
      // Create without is_listing_form (column absent).
      const created = await supabaseAdmin
        .from('marketing_forms')
        .insert({ venue_id: venueId, name: 'Listing Lead Form', published: true })
        .select('id')
        .single();
      return created.data ? (created.data.id as string) : null;
    }

    // No existing row — create it with the flag.
    const { data: created } = await supabaseAdmin
      .from('marketing_forms')
      .insert({ venue_id: venueId, name: 'Listing Lead Form', is_listing_form: true, published: true })
      .select('id')
      .single();

    return created ? (created.id as string) : null;
  } catch (e) {
    console.error('[listing-lead-form] ensureListingForm failed:', e);
    return null;
  }
}
