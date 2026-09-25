/**
 * Put a lead's answers where the Contact profile reads them (`venue_customers`).
 *
 * Shared by LeadFinder ingest, the LeadFinder review queue and the gated guide
 * invite, so every path that learns something about a couple writes it to the
 * contact the same way. Lives in its own module so none of those callers has to
 * import another (ingest ↔ guide-invite would otherwise be circular).
 */

import { supabaseAdmin } from '@/lib/supabase';

/** The answers a lead can carry onto its contact. Null means "don't touch". */
export interface LeadContactAnswers {
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  guestCount: number | null;
  timeline: string | null;
  venueMatters: string | null;
  weddingDate: string | null;
}

/**
 * Mirror the enquiry answers onto the contact record.
 *
 * The lead is not where the profile UI reads from: the Contact profile's Event
 * Details card is populated from `venue_customers`. A lead alone is therefore
 * invisible in those boxes, which is what made a captured guest count and
 * wedding date look like they had never arrived.
 *
 * Only fields we actually have are written, so a later email that is missing a
 * phone can never blank one the venue already had.
 *
 * Best-effort and deliberately separate from the lead write: an unknown column
 * on an older deploy fails only this statement, not the lead itself.
 */
export async function syncLeadAnswersToContact(
  venueId: string,
  email: string,
  e: LeadContactAnswers,
): Promise<void> {
  const key = email.toLowerCase();
  try {
    const row: Record<string, unknown> = {
      venue_id: venueId,
      customer_email: key,
      updated_at: new Date().toISOString(),
    };
    if (e.firstName) row.first_name = e.firstName;
    if (e.lastName) row.last_name = e.lastName;
    if (e.phone) row.phone = e.phone;
    if (e.guestCount !== null) row.guest_count = e.guestCount;

    const { error } = await supabaseAdmin
      .from('venue_customers')
      .upsert(row, { onConflict: 'venue_id,customer_email' });
    if (error) console.warn('[contact-sync] venue_customers upsert:', error.message);
  } catch (err) {
    console.warn('[contact-sync] venue_customers upsert threw:', err);
  }

  // The enquiry answers live in a separate update, matching how the public lead
  // path does it. `wedding_date` is included here even though the public form
  // never sends one (it is deliberately left blank as a reason to call) — when
  // an email does disclose a date, there is no reason to discard it.
  const inquiry: Record<string, string> = {};
  if (e.timeline)     inquiry.booking_timeline = e.timeline;
  if (e.venueMatters) inquiry.venue_matters = e.venueMatters;
  if (e.weddingDate)  inquiry.wedding_date = e.weddingDate;

  if (Object.keys(inquiry).length > 0) {
    try {
      const { error } = await supabaseAdmin
        .from('venue_customers')
        .update(inquiry)
        .eq('venue_id', venueId)
        .eq('customer_email', key);
      if (error) console.warn('[contact-sync] venue_customers inquiry update:', error.message);
    } catch (err) {
      console.warn('[contact-sync] venue_customers inquiry update threw:', err);
    }
  }
}
