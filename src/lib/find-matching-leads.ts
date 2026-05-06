/**
 * Find all lead IDs that should be considered "the same person" as a given
 * contact (venue_customer / inbound bride). Used by both the venue-side leads
 * PATCH broadcast and the admin support inbox bride-context API so tag/stage
 * sync stays consistent across the SaaS.
 *
 * Matching strategy:
 *   1. Email — case-insensitive (ilike)
 *   2. Phone — exact match AND a fallback last-10-digits match for venues
 *      where the phone has been stored in different formats over time
 *      (e.g. "(555) 123-4567" vs "+15551234567")
 *
 * This is intentionally permissive — false positives are far less harmful
 * than missing tags on the support agent's screen.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { normalizePhoneDigits } from '@/lib/lead-duplicates';

export interface MatchInput {
  venueId: string;
  email?: string | null;
  phone?: string | null;
}

/**
 * Returns the set of lead IDs that match the supplied contact details,
 * scoped to the given venue. Always returns a Set (possibly empty).
 */
export async function findMatchingLeadIds(input: MatchInput): Promise<Set<string>> {
  const ids = new Set<string>();
  const venueId = input.venueId;
  const email = (input.email ?? '').trim().toLowerCase();
  const rawPhone = (input.phone ?? '').trim();
  const phoneDigits = normalizePhoneDigits(rawPhone);

  if (email) {
    const { data } = await supabaseAdmin
      .from('leads')
      .select('id')
      .eq('venue_id', venueId)
      .ilike('email', email);
    for (const r of (data ?? []) as Array<{ id: string }>) ids.add(r.id);
  }

  if (rawPhone) {
    const { data } = await supabaseAdmin
      .from('leads')
      .select('id')
      .eq('venue_id', venueId)
      .eq('phone', rawPhone);
    for (const r of (data ?? []) as Array<{ id: string }>) ids.add(r.id);
  }

  // Loose digit-only fallback so format differences ("(555) 123-4567" vs
  // "+15551234567") still resolve to the same person. We can't do this in a
  // single SQL query because we don't have a generated digits column, so we
  // pull a small candidate set keyed off email/venue and filter in memory.
  if (phoneDigits) {
    const { data } = await supabaseAdmin
      .from('leads')
      .select('id, phone')
      .eq('venue_id', venueId)
      .not('phone', 'is', null);
    for (const r of (data ?? []) as Array<{ id: string; phone: string | null }>) {
      const d = normalizePhoneDigits(r.phone);
      if (d && d === phoneDigits) ids.add(r.id);
    }
  }

  return ids;
}

/**
 * Same as findMatchingLeadIds but returns the venue_customers (contacts)
 * matching the same heuristic. Used to fan out tag-change broadcasts to
 * every conversation thread tied to a sister contact.
 */
export async function findMatchingVenueCustomerIds(input: MatchInput): Promise<Set<string>> {
  const ids = new Set<string>();
  const venueId = input.venueId;
  const email = (input.email ?? '').trim().toLowerCase();
  const rawPhone = (input.phone ?? '').trim();
  const phoneDigits = normalizePhoneDigits(rawPhone);

  if (email) {
    const { data } = await supabaseAdmin
      .from('venue_customers')
      .select('id')
      .eq('venue_id', venueId)
      .ilike('customer_email', email);
    for (const r of (data ?? []) as Array<{ id: string }>) ids.add(r.id);
  }

  if (rawPhone) {
    const { data } = await supabaseAdmin
      .from('venue_customers')
      .select('id')
      .eq('venue_id', venueId)
      .eq('phone', rawPhone);
    for (const r of (data ?? []) as Array<{ id: string }>) ids.add(r.id);
  }

  if (phoneDigits) {
    const { data } = await supabaseAdmin
      .from('venue_customers')
      .select('id, phone')
      .eq('venue_id', venueId)
      .not('phone', 'is', null);
    for (const r of (data ?? []) as Array<{ id: string; phone: string | null }>) {
      const d = normalizePhoneDigits(r.phone);
      if (d && d === phoneDigits) ids.add(r.id);
    }
  }

  return ids;
}
