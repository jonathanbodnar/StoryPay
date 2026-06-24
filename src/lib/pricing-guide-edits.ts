import { supabaseAdmin } from '@/lib/supabase';

/**
 * Manual-override tracking for the pricing guide.
 *
 * `venue_pricing_guides.edited_fields` is a JSONB map of { field: true }. Once
 * the owner manually edits a field (through the editor or the onboarding review
 * step) the auto-fill paths — Google import and `draft-guide` regeneration —
 * must never overwrite it. Every function here is best-effort: if the column
 * does not exist yet (migration 149 not applied) it silently no-ops so the rest
 * of the save still succeeds.
 */
export const TRACKABLE_GUIDE_FIELDS = [
  'congratulatory_message',
  'about_venue',
  'pricing_intro',
  'availability_text',
  'cta_headline',
  'cta_body',
  'gallery',
  'about_photos',
  'cover_image_url',
  'reviews',
] as const;

const TRACKABLE = new Set<string>(TRACKABLE_GUIDE_FIELDS);

/** Mark the given guide fields as user-edited. No-op if the column is absent. */
export async function markGuideFieldsEdited(venueId: string, fields: string[]): Promise<void> {
  const tracked = fields.filter((f) => TRACKABLE.has(f));
  if (!tracked.length) return;
  try {
    const { data, error } = await supabaseAdmin
      .from('venue_pricing_guides')
      .select('id, edited_fields')
      .eq('venue_id', venueId)
      .maybeSingle();
    if (error || !data) return;
    const current =
      data.edited_fields && typeof data.edited_fields === 'object'
        ? (data.edited_fields as Record<string, boolean>)
        : {};
    const merged: Record<string, boolean> = { ...current };
    let changed = false;
    for (const f of tracked) if (!merged[f]) { merged[f] = true; changed = true; }
    if (!changed) return;
    await supabaseAdmin
      .from('venue_pricing_guides')
      .update({ edited_fields: merged })
      .eq('id', data.id as string);
  } catch {
    /* column may not exist yet — non-fatal */
  }
}

/** Returns the map of user-edited fields (empty if the column is absent). */
export async function loadEditedFields(venueId: string): Promise<Record<string, boolean>> {
  try {
    const { data, error } = await supabaseAdmin
      .from('venue_pricing_guides')
      .select('edited_fields')
      .eq('venue_id', venueId)
      .maybeSingle();
    if (error || !data || !data.edited_fields || typeof data.edited_fields !== 'object') return {};
    return data.edited_fields as Record<string, boolean>;
  } catch {
    return {};
  }
}
