import { supabaseAdmin } from '@/lib/supabase';
import { loadVenueFeatureAccess } from '@/lib/plan-features';

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

// ── Venue-controlled visibility of wedding data to the bride ─────────────────

/** Wedding-data categories the venue can choose to share with the bride. */
export const BRIDE_PORTAL_VISIBILITY_KEYS = [
  'wedding_date',
  'guest_count',
  'space',
  'coordinator',
] as const;

export type BridePortalVisibilityKey = (typeof BRIDE_PORTAL_VISIBILITY_KEYS)[number];
export type BridePortalVisibility = Record<BridePortalVisibilityKey, boolean>;

/**
 * Resolve a venue's stored visibility JSON into an explicit map. Categories
 * default to shared (true) — the venue opts OUT by unchecking. An empty {}
 * therefore means "share everything", which is the sensible out-of-the-box
 * behaviour for a relationship-deepening portal.
 */
export function resolveBridePortalVisibility(
  raw: Record<string, unknown> | null | undefined,
): BridePortalVisibility {
  const out = {} as BridePortalVisibility;
  for (const key of BRIDE_PORTAL_VISIBILITY_KEYS) {
    out[key] = raw?.[key] !== false;
  }
  return out;
}

export interface VenueBridePortalConfig {
  /** Whether the venue can use the Bride Portal at all. Reflects the real gate:
   *  legacy + All-Inclusive plans, or the admin Bride Portal override flag. */
  enabled: boolean;
  visibility: BridePortalVisibility;
}

/** Load a venue's Bride Portal access + visibility settings. */
export async function getVenueBridePortalConfig(
  venueId: string,
): Promise<VenueBridePortalConfig> {
  const [{ data }, access] = await Promise.all([
    supabaseAdmin.from('venues').select('bride_portal_visibility').eq('id', venueId).maybeSingle(),
    loadVenueFeatureAccess(venueId),
  ]);
  const row = (data ?? {}) as { bride_portal_visibility?: Record<string, unknown> | null };
  return {
    enabled: access.hasBridePortal,
    visibility: resolveBridePortalVisibility(row.bride_portal_visibility),
  };
}

// ── Guest list summary (shared by bride + venue rollups) ─────────────────────

export interface WeddingGuestSummary {
  /** Total guest rows (invited parties). */
  total: number;
  attending: number;
  declined: number;
  pending: number;
  /** Sum of party_size across attending rows — the venue headcount. */
  headcount: number;
  /** Meal choice → count of attending guests who picked it. */
  mealCounts: Record<string, number>;
}

export interface WeddingGuestRowLite {
  rsvp_status?: string | null;
  party_size?: number | null;
  meal_choice?: string | null;
}

export function summarizeWeddingGuests(rows: WeddingGuestRowLite[]): WeddingGuestSummary {
  const summary: WeddingGuestSummary = {
    total: rows.length,
    attending: 0,
    declined: 0,
    pending: 0,
    headcount: 0,
    mealCounts: {},
  };
  for (const r of rows) {
    const status = r.rsvp_status === 'attending' || r.rsvp_status === 'declined' ? r.rsvp_status : 'pending';
    summary[status] += 1;
    if (status === 'attending') {
      const size = Math.max(1, Number(r.party_size) || 1);
      summary.headcount += size;
      const meal = (r.meal_choice ?? '').trim();
      if (meal) summary.mealCounts[meal] = (summary.mealCounts[meal] ?? 0) + size;
    }
  }
  return summary;
}
