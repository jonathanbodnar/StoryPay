import { supabaseAdmin } from '@/lib/supabase';

/**
 * Server-side helpers for the "bride portal" bridge (couple_weddings).
 *
 * A couple_weddings row links an authenticated couple (auth.users, role=couple)
 * to a venue's booked-customer record (venue_customers). Once status='linked'
 * with a venue_customer_id, the bride can view her wedding and message the venue
 * through the shared conversation thread.
 *
 * All access goes through the service role; callers are responsible for
 * verifying the couple/venue identity before invoking these helpers.
 */

export type CoupleWeddingStatus = 'pending' | 'linked' | 'declined' | 'revoked';

export interface CoupleWeddingRow {
  id: string;
  couple_id: string | null;
  venue_id: string;
  venue_customer_id: string | null;
  status: CoupleWeddingStatus;
  initiated_by: 'venue' | 'bride';
  invited_email: string | null;
  invited_name: string | null;
  request_message: string | null;
  claim_token: string | null;
  claim_token_expires_at: string | null;
  created_at: string;
  updated_at: string;
  linked_at: string | null;
  decided_at: string | null;
}

/** The reader_ref used for the bride side of a conversation thread. */
export function coupleReaderRef(coupleId: string): string {
  return `couple:${coupleId}`;
}

/**
 * The single active (linked first, else pending) wedding link for a couple.
 * Linked links win over pending so a claimed wedding always surfaces.
 */
export async function getActiveCoupleWedding(
  coupleId: string,
): Promise<CoupleWeddingRow | null> {
  const { data } = await supabaseAdmin
    .from('couple_weddings')
    .select('*')
    .eq('couple_id', coupleId)
    .in('status', ['pending', 'linked'])
    .order('status', { ascending: true }) // 'linked' < 'pending' alphabetically
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as CoupleWeddingRow | null) ?? null;
}

/**
 * A pending venue -> bride invite addressed to this email that has NOT yet been
 * claimed (couple_id still NULL). Used to prompt a freshly-signed-up bride to
 * accept an invite that predates her account.
 */
export async function getPendingInviteForEmail(
  email: string,
): Promise<CoupleWeddingRow | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  const { data } = await supabaseAdmin
    .from('couple_weddings')
    .select('*')
    .is('couple_id', null)
    .eq('status', 'pending')
    .eq('initiated_by', 'venue')
    .ilike('invited_email', normalized)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as CoupleWeddingRow | null) ?? null;
}

/**
 * Return the most recent conversation thread for a venue_customer, creating one
 * if none exists yet. Threads carry both venue and bride messages.
 */
export async function ensureThreadForCustomer(
  venueId: string,
  venueCustomerId: string,
): Promise<string | null> {
  const { data: existing } = await supabaseAdmin
    .from('conversation_threads')
    .select('id')
    .eq('venue_id', venueId)
    .eq('venue_customer_id', venueCustomerId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return (existing as { id: string }).id;

  const { data: created, error } = await supabaseAdmin
    .from('conversation_threads')
    .insert({
      venue_id: venueId,
      venue_customer_id: venueCustomerId,
      subject: 'Conversation',
      external_reply_channel: 'email',
    })
    .select('id')
    .single();
  if (error) {
    console.error('[couple-weddings] ensureThreadForCustomer', error);
    return null;
  }
  return (created as { id: string } | null)?.id ?? null;
}

/** Public venue summary shown to a bride for a linked/pending wedding. */
export interface CoupleWeddingVenue {
  id: string;
  slug: string | null;
  name: string | null;
  cover_image_url: string | null;
  location_city: string | null;
  location_state: string | null;
}

export async function getVenueSummary(
  venueId: string,
): Promise<CoupleWeddingVenue | null> {
  const { data } = await supabaseAdmin
    .from('venues')
    .select('id, slug, name, cover_image_url, location_city, location_state')
    .eq('id', venueId)
    .maybeSingle();
  return (data as CoupleWeddingVenue | null) ?? null;
}
