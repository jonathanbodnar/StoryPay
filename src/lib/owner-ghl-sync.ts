/**
 * Platform-owner GHL sync + alerts.
 *
 * DISTINCT from `owner-notifications.ts` (which notifies each VENUE OWNER about
 * their own events using the venue's own GHL creds). This module is about the
 * PLATFORM owner — the person running StoryVenue — who wants:
 *
 *   1. Every SaaS venue (their customers) pushed as a contact into THEIR OWN
 *      GHL sub-account, one-way (SaaS → GHL), so they have one accurate list to
 *      build automations on.
 *   2. An SMS to themselves every time a new venue listing goes live.
 *
 * All sends use the owner's GHL sub-account, configured via env (never hardcode
 * the token):
 *
 *   OWNER_GHL_LOCATION_ID  — the owner's StoryVenue GHL sub-account/location id
 *   OWNER_GHL_PIT_TOKEN    — a Private Integration Token (pit-*) for that sub-account
 *   OWNER_ALERT_PHONE      — the owner's cell (E.164 or US 10-digit) that alerts text to
 *
 * Everything here is best-effort and never throws — the caller's primary flow
 * (e.g. onboarding publish) must never be blocked or failed by a sync issue.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { findOrCreateContact, normalizePhone, sendSms } from '@/lib/ghl';

const DIRECTORY_URL = (process.env.NEXT_PUBLIC_DIRECTORY_URL || 'https://storyvenue.com').replace(/\/$/, '');

interface OwnerGhlConfig {
  locationId: string;
  token: string;
  /** May be empty — owner-GHL push still works, only the self-SMS needs it. */
  alertPhone: string | null;
}

/**
 * Read the owner's GHL config from env. Returns null when the two required
 * values (location id + token) aren't set, so callers become clean no-ops in
 * environments where the integration isn't configured.
 */
export function getOwnerGhlConfig(): OwnerGhlConfig | null {
  const locationId = (process.env.OWNER_GHL_LOCATION_ID || '').trim();
  const token = (process.env.OWNER_GHL_PIT_TOKEN || '').trim();
  if (!locationId || !token) return null;
  const alertPhone = normalizePhone(process.env.OWNER_ALERT_PHONE || '') || null;
  return { locationId, token, alertPhone };
}

export function isOwnerGhlConfigured(): boolean {
  return getOwnerGhlConfig() !== null;
}

interface VenueSyncRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  owner_first_name: string | null;
  owner_last_name: string | null;
  slug: string | null;
  city: string | null;
  state: string | null;
  owner_ghl_contact_id: string | null;
}

const VENUE_SYNC_COLUMNS =
  'id, name, email, phone, owner_first_name, owner_last_name, slug, city, state, owner_ghl_contact_id';

async function loadVenueForSync(venueId: string): Promise<VenueSyncRow | null> {
  const { data, error } = await supabaseAdmin
    .from('venues')
    .select(VENUE_SYNC_COLUMNS)
    .eq('id', venueId)
    .maybeSingle();
  if (error) {
    console.warn('[owner-ghl-sync] loadVenueForSync failed:', error.message);
    return null;
  }
  return (data as VenueSyncRow | null) ?? null;
}

/**
 * Derive the contact name for a venue inside the owner's CRM. Prefer the
 * owner's real name; fall back to the venue name so the contact is never blank.
 */
function venueContactName(v: VenueSyncRow): { firstName: string; lastName: string } {
  const first = (v.owner_first_name ?? '').trim();
  const last = (v.owner_last_name ?? '').trim();
  if (first || last) return { firstName: first || (v.name ?? 'Venue'), lastName: last };
  // No owner name — use the venue name as the first name.
  return { firstName: (v.name ?? '').trim() || 'Venue', lastName: '' };
}

/**
 * Push a single venue into the owner's GHL sub-account as a contact (one-way).
 * Idempotent: reuses `owner_ghl_contact_id` when present, otherwise
 * find-or-creates by email/phone and persists the id back.
 *
 * Returns the owner-GHL contact id, or null when nothing could be synced
 * (not configured, no email/phone, or GHL rejected the write).
 */
export async function pushVenueToOwnerGhl(
  venueIdOrRow: string | VenueSyncRow,
): Promise<string | null> {
  const cfg = getOwnerGhlConfig();
  if (!cfg) return null;

  const venue = typeof venueIdOrRow === 'string' ? await loadVenueForSync(venueIdOrRow) : venueIdOrRow;
  if (!venue) return null;

  const email = (venue.email ?? '').trim() || undefined;
  const phone = normalizePhone(venue.phone) ?? undefined;
  if (!email && !phone) {
    console.log('[owner-ghl-sync] skip: venue has no email or phone', venue.id);
    return venue.owner_ghl_contact_id;
  }

  const { firstName, lastName } = venueContactName(venue);

  try {
    const contactId = await findOrCreateContact(cfg.token, cfg.locationId, {
      email,
      phone,
      firstName,
      lastName,
    });
    if (contactId && contactId !== venue.owner_ghl_contact_id) {
      await supabaseAdmin
        .from('venues')
        .update({ owner_ghl_contact_id: contactId })
        .eq('id', venue.id);
    }
    if (contactId) {
      console.log('[owner-ghl-sync] synced venue', venue.id, '→ owner GHL contact', contactId);
    }
    return contactId ?? venue.owner_ghl_contact_id;
  } catch (err) {
    console.warn('[owner-ghl-sync] pushVenueToOwnerGhl failed for', venue.id, err instanceof Error ? err.message : err);
    return venue.owner_ghl_contact_id;
  }
}

/** Public listing URL for a venue slug (used in the owner alert). */
function venueLiveUrl(slug: string | null): string | null {
  return slug ? `${DIRECTORY_URL}/venue/${slug}` : null;
}

/**
 * Send the platform owner an SMS via their own GHL sub-account A2P number.
 * Best-effort. Requires OWNER_ALERT_PHONE to be set.
 */
export async function sendOwnerSms(message: string): Promise<boolean> {
  const cfg = getOwnerGhlConfig();
  if (!cfg) return false;
  if (!cfg.alertPhone) {
    console.warn('[owner-ghl-sync] sendOwnerSms skipped: OWNER_ALERT_PHONE not set');
    return false;
  }
  try {
    // The owner must exist as a contact in their own sub-account for GHL to
    // route an SMS to them. find-or-create is idempotent.
    const contactId = await findOrCreateContact(cfg.token, cfg.locationId, {
      phone: cfg.alertPhone,
      firstName: 'StoryVenue',
      lastName: 'Alerts',
    });
    if (!contactId) {
      console.warn('[owner-ghl-sync] sendOwnerSms: could not resolve owner contact');
      return false;
    }
    await sendSms(cfg.token, cfg.locationId, contactId, message, undefined, cfg.alertPhone);
    return true;
  } catch (err) {
    console.warn('[owner-ghl-sync] sendOwnerSms failed:', err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Fire when a venue listing goes live. Exactly-once via
 * `owner_listing_alert_sent_at`:
 *   - pushes the venue into the owner's GHL sub-account, AND
 *   - texts the owner that a new listing is live.
 *
 * Safe to call on every publish — subsequent calls are no-ops.
 */
export async function onNewListingLive(venueId: string): Promise<void> {
  const cfg = getOwnerGhlConfig();
  if (!cfg) return;

  const venue = await loadVenueForSync(venueId);
  if (!venue) return;

  // Idempotency gate — has the owner already been alerted for this venue?
  const { data: gate } = await supabaseAdmin
    .from('venues')
    .select('owner_listing_alert_sent_at')
    .eq('id', venueId)
    .maybeSingle();
  if ((gate as { owner_listing_alert_sent_at?: string | null } | null)?.owner_listing_alert_sent_at) {
    return; // already alerted
  }

  // Stamp FIRST to close the race — two near-simultaneous publishes shouldn't
  // both send. If the sends below fail, the venue is still captured by the
  // backfill route later.
  await supabaseAdmin
    .from('venues')
    .update({ owner_listing_alert_sent_at: new Date().toISOString() })
    .eq('id', venueId);

  // 1. One-way sync this venue into the owner's GHL list.
  await pushVenueToOwnerGhl(venue);

  // 2. Text the owner.
  const name = (venue.name ?? '').trim() || 'A new venue';
  const place = [venue.city, venue.state].filter(Boolean).join(', ');
  const url = venueLiveUrl(venue.slug);
  const body =
    `New StoryVenue listing live: ${name}` +
    (place ? ` — ${place}` : '') +
    (url ? `. ${url}` : '');
  await sendOwnerSms(body);
}

/** Fire-and-forget wrapper for request handlers. Never blocks the response. */
export function scheduleOnNewListingLive(venueId: string): void {
  void onNewListingLive(venueId).catch((err) => {
    console.error('[owner-ghl-sync] onNewListingLive threw', err);
  });
}
