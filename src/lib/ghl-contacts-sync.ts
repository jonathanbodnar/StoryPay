/**
 * GHL → StoryVenue contact sync.
 *
 * Pulls every contact from a venue's GHL sub-account and mirrors them into
 * our `venue_customers` table so the venue's contact directory survives
 * regardless of whether GHL stays connected.
 *
 * Usage:
 *   - Manual:   POST /api/integrations/ghl/sync-contacts        (per-venue trigger)
 *   - Cron:     GET  /api/cron/ghl-contacts-sync                (all GHL-connected venues)
 *   - Webhook:  ContactCreate / ContactUpdate from GHL webhook
 */

import { supabaseAdmin } from '@/lib/supabase';
import {
  ghlRequest,
  normalizePhone,
  refreshAccessToken,
  resolveLocationToken,
  classifyToken,
} from '@/lib/ghl';
import { ensureLocationToken } from '@/lib/ghl-auth';
import { ghlDndToConversationFlags } from '@/app/api/venue-customers/[id]/dnd/route';

const PLACEHOLDER_EMAIL_DOMAIN = 'ghl-import.storyvenue.placeholder';
const PAGE_SIZE = 100;
const MAX_PAGES = 200; // safety cap = 20 000 contacts per run

// ── Types ────────────────────────────────────────────────────────────────────

type GhlDndChannelStatus = 'active' | 'inactive' | string;

interface GhlDndChannelEntry {
  status?: GhlDndChannelStatus;
  message?: string;
  code?: string;
}

/** GHL per-channel outbound DND settings (keys are capitalised: Call, Email, SMS, GMB, WhatsApp, FB) */
type GhlDndSettings = Partial<Record<'Call' | 'Email' | 'SMS' | 'WhatsApp' | 'GMB' | 'FB', GhlDndChannelEntry>>;

/** GHL inbound DND settings */
interface GhlInboundDndSettings {
  all?: GhlDndChannelEntry;
}

interface GhlContact {
  id: string;
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  contactName?: string | null;
  tags?: string[] | null;
  source?: string | null;
  dateAdded?: string | null;
  dateUpdated?: string | null;
  /** Master DND flag — true when any outbound channel is blocked */
  dnd?: boolean | null;
  /** Per-channel outbound DND */
  dndSettings?: GhlDndSettings | null;
  /** Inbound DND (Inbound Calls and SMS) */
  inboundDndSettings?: GhlInboundDndSettings | null;
}

interface SyncCounts {
  fetched: number;
  created: number;
  updated: number;
  linked: number;   // existing customer matched by email — backfilled with ghl_contact_id
  errors: number;
}

interface VenueRow {
  id: string;
  ghl_location_id: string | null;
  ghl_access_token: string | null;
  ghl_refresh_token?: string | null;
  ghl_connected: boolean | null;
}

// ── Token resolution (with refresh) ──────────────────────────────────────────

/**
 * Get a working access token for the venue. If the venue has a refresh token
 * and the API rejects the access token, refresh and persist.
 */

async function tryRefresh(venue: VenueRow): Promise<string | null> {
  if (!venue.ghl_refresh_token) return null;
  try {
    const tokens = await refreshAccessToken(venue.ghl_refresh_token);
    await supabaseAdmin
      .from('venues')
      .update({
        ghl_access_token: tokens.access_token,
        ghl_refresh_token: tokens.refresh_token,
      })
      .eq('id', venue.id);
    return tokens.access_token as string;
  } catch (err) {
    console.error('[ghl-contacts-sync] refresh failed for venue', venue.id, err);
    return null;
  }
}

// ── GHL list pagination ──────────────────────────────────────────────────────

/**
 * Fetch one page of contacts. Uses the "/contacts/?locationId=X&limit=...&startAfter=...&startAfterId=..."
 * cursor pagination supported by GHL v2.
 */
async function fetchContactPage(
  token: string,
  locationId: string,
  startAfter: string | null,
  startAfterId: string | null,
): Promise<{ contacts: GhlContact[]; nextStartAfter: string | null; nextStartAfterId: string | null }> {
  const qs = new URLSearchParams({
    locationId,
    limit: String(PAGE_SIZE),
  });
  if (startAfter)   qs.set('startAfter',   startAfter);
  if (startAfterId) qs.set('startAfterId', startAfterId);

  const result = await ghlRequest(`/contacts/?${qs.toString()}`, token, { locationId }) as {
    contacts?: GhlContact[];
    meta?: {
      startAfter?: string | number | null;
      startAfterId?: string | null;
      nextPageUrl?: string | null;
    };
  };

  const contacts = result.contacts ?? [];
  const meta     = result.meta ?? {};
  const nextStartAfter   = meta.startAfter ? String(meta.startAfter) : null;
  const nextStartAfterId = meta.startAfterId ?? null;

  return { contacts, nextStartAfter, nextStartAfterId };
}

// ── Upsert ───────────────────────────────────────────────────────────────────

interface UpsertResult { kind: 'created' | 'updated' | 'linked' | 'error'; }

async function upsertContact(venueId: string, c: GhlContact): Promise<UpsertResult> {
  const email     = (c.email ?? '').trim().toLowerCase();
  const phone     = normalizePhone(c.phone ?? null) || (c.phone ?? null);
  const firstName = (c.firstName ?? '').trim();
  const lastName  = (c.lastName ?? '').trim();
  const nowIso    = new Date().toISOString();

  // Build a friendly name fallback when first/last are blank.
  const fallbackFirst = firstName || (c.contactName?.split(' ')[0] ?? '') || 'Contact';

  // DND — derive our sms_dnd flag from GHL's SMS channel status
  const smsDndFromGhl = c.dndSettings?.SMS?.status === 'active' || c.dnd === true;
  const ghlDndSettings = c.dndSettings ?? null;
  const ghlInboundDndSettings = c.inboundDndSettings ?? null;

  // 1. Match by ghl_contact_id (idempotent re-sync) ───────────────────────────
  {
    const { data: existing } = await supabaseAdmin
      .from('venue_customers')
      .select('id, customer_email')
      .eq('venue_id', venueId)
      .eq('ghl_contact_id', c.id)
      .maybeSingle();

    if (existing?.id) {
      const update: Record<string, unknown> = {
        first_name: fallbackFirst,
        last_name : lastName,
        phone     : phone,
        ghl_synced_at: nowIso,
        updated_at: nowIso,
      };
      // Only overwrite email if GHL has a real one and it's different from
      // what we have stored (and not just a placeholder we generated).
      if (email && email !== existing.customer_email) {
        update.customer_email = email;
      }
      // Sync GHL DND settings — also bridge into flat enforcement columns
      if (ghlDndSettings !== null || ghlInboundDndSettings !== null) {
        if (ghlDndSettings !== null) update.ghl_dnd_settings = ghlDndSettings;
        if (ghlInboundDndSettings !== null) update.ghl_inbound_dnd_settings = ghlInboundDndSettings;
        const flags = ghlDndToConversationFlags(ghlDndSettings, ghlInboundDndSettings);
        update.conversation_dnd_email = flags.conversation_dnd_email;
        update.conversation_dnd_calls = flags.conversation_dnd_calls;
        update.conversation_dnd_inbound_sms = flags.conversation_dnd_inbound_sms;
        update.conversation_dnd_all = flags.conversation_dnd_all;
        // sms_dnd: only set to true from GHL; never auto-clear (manual clear required)
        if (flags.sms_dnd) {
          update.sms_dnd = true;
          update.sms_dnd_source = 'ghl_sync';
          update.sms_dnd_at = nowIso;
        }
      }
      const { error } = await supabaseAdmin
        .from('venue_customers')
        .update(update)
        .eq('id', existing.id);
      if (error) {
        console.error('[ghl-contacts-sync] update by ghl_contact_id', error);
        return { kind: 'error' };
      }
      return { kind: 'updated' };
    }
  }

  // 2. Match by (venue_id, customer_email) and back-fill ghl_contact_id ──────
  if (email) {
    const { data: byEmail } = await supabaseAdmin
      .from('venue_customers')
      .select('id')
      .eq('venue_id', venueId)
      .eq('customer_email', email)
      .maybeSingle();

    if (byEmail?.id) {
      const linkUpdate: Record<string, unknown> = {
        ghl_contact_id: c.id,
        first_name    : firstName || undefined,
        last_name     : lastName  || undefined,
        phone         : phone     || undefined,
        ghl_synced_at : nowIso,
        updated_at    : nowIso,
      };
      if (ghlDndSettings !== null || ghlInboundDndSettings !== null) {
        if (ghlDndSettings !== null) linkUpdate.ghl_dnd_settings = ghlDndSettings;
        if (ghlInboundDndSettings !== null) linkUpdate.ghl_inbound_dnd_settings = ghlInboundDndSettings;
        const flags = ghlDndToConversationFlags(ghlDndSettings, ghlInboundDndSettings);
        linkUpdate.conversation_dnd_email = flags.conversation_dnd_email;
        linkUpdate.conversation_dnd_calls = flags.conversation_dnd_calls;
        linkUpdate.conversation_dnd_inbound_sms = flags.conversation_dnd_inbound_sms;
        linkUpdate.conversation_dnd_all = flags.conversation_dnd_all;
        if (flags.sms_dnd) {
          linkUpdate.sms_dnd = true;
          linkUpdate.sms_dnd_source = 'ghl_sync';
          linkUpdate.sms_dnd_at = nowIso;
        }
      }
      const { error } = await supabaseAdmin
        .from('venue_customers')
        .update(linkUpdate)
        .eq('id', byEmail.id);
      if (error) {
        console.error('[ghl-contacts-sync] link by email', error);
        return { kind: 'error' };
      }
      return { kind: 'linked' };
    }
  }

  // 3. Insert a brand-new customer ────────────────────────────────────────────
  const insertEmail = email || `ghl.${c.id}@${PLACEHOLDER_EMAIL_DOMAIN}`;
  const insertRow: Record<string, unknown> = {
    venue_id      : venueId,
    ghl_contact_id: c.id,
    customer_email: insertEmail,
    first_name    : fallbackFirst,
    last_name     : lastName,
    phone         : phone || null,
    ghl_synced_at : nowIso,
  };
  if (ghlDndSettings !== null || ghlInboundDndSettings !== null) {
    if (ghlDndSettings !== null) insertRow.ghl_dnd_settings = ghlDndSettings;
    if (ghlInboundDndSettings !== null) insertRow.ghl_inbound_dnd_settings = ghlInboundDndSettings;
    const flags = ghlDndToConversationFlags(ghlDndSettings, ghlInboundDndSettings);
    insertRow.conversation_dnd_email = flags.conversation_dnd_email;
    insertRow.conversation_dnd_calls = flags.conversation_dnd_calls;
    insertRow.conversation_dnd_inbound_sms = flags.conversation_dnd_inbound_sms;
    insertRow.conversation_dnd_all = flags.conversation_dnd_all;
    if (flags.sms_dnd) {
      insertRow.sms_dnd = true;
      insertRow.sms_dnd_source = 'ghl_sync';
      insertRow.sms_dnd_at = nowIso;
    }
  }
  const { error } = await supabaseAdmin
    .from('venue_customers')
    .insert(insertRow);

  if (error) {
    // 23505 = unique violation; race condition with a parallel job — fall back to update.
    if (error.code === '23505') {
      const { data: byEmail } = await supabaseAdmin
        .from('venue_customers')
        .select('id')
        .eq('venue_id', venueId)
        .eq('customer_email', insertEmail)
        .maybeSingle();
      if (byEmail?.id) {
        await supabaseAdmin
          .from('venue_customers')
          .update({ ghl_contact_id: c.id, ghl_synced_at: nowIso })
          .eq('id', byEmail.id);
        return { kind: 'linked' };
      }
    }
    console.error('[ghl-contacts-sync] insert failed', error);
    return { kind: 'error' };
  }
  return { kind: 'created' };
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function syncGhlContactsForVenue(venueId: string): Promise<SyncCounts> {
  const counts: SyncCounts = { fetched: 0, created: 0, updated: 0, linked: 0, errors: 0 };

  const { data: venueRaw, error: venueErr } = await supabaseAdmin
    .from('venues')
    .select('id, ghl_location_id, ghl_access_token, ghl_refresh_token, ghl_connected')
    .eq('id', venueId)
    .maybeSingle();

  if (venueErr || !venueRaw) {
    throw new Error(venueErr?.message ?? 'venue not found');
  }
  const venue = venueRaw as VenueRow;

  if (!venue.ghl_location_id) {
    throw new Error('venue is not connected to a Legacy messaging location');
  }

  // Single helper handles all token types and caches v1 location keys.
  let token = await ensureLocationToken({
    id: venue.id,
    ghl_location_id: venue.ghl_location_id,
    ghl_access_token: venue.ghl_access_token,
  });

  // For v2 OAuth, also do the location-token exchange (no-op for v1 / PIT).
  if (classifyToken(token) === 'v2-oauth') {
    try {
      token = await resolveLocationToken(token, venue.ghl_location_id);
    } catch (err) {
      const agencyKey = process.env.GHL_AGENCY_API_KEY || process.env.GHL_PRIVATE_KEY || null;
      if (!agencyKey || agencyKey === token) throw err;
      console.warn('[ghl-contacts-sync] OAuth token exchange failed, retrying with env agency key:', err);
      token = await resolveLocationToken(agencyKey, venue.ghl_location_id);
    }
  }

  let startAfter: string | null   = null;
  let startAfterId: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    let pageData: { contacts: GhlContact[]; nextStartAfter: string | null; nextStartAfterId: string | null };
    try {
      pageData = await fetchContactPage(token, venue.ghl_location_id, startAfter, startAfterId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      // 401 → try a one-shot refresh & retry the page once.
      if (/\b401\b/.test(msg)) {
        let refreshed: string | null = null;
        // Attempt OAuth refresh first (if the venue has a refresh token).
        if (venue.ghl_refresh_token) {
          refreshed = await tryRefresh(venue);
        }
        // If OAuth refresh wasn't available or failed, fall back to the
        // agency key. This is the primary path for legacy clients that
        // were connected via the agency flow and don't have per-venue
        // OAuth tokens.
        if (!refreshed) {
          const agencyKey = process.env.GHL_AGENCY_API_KEY || process.env.GHL_PRIVATE_KEY || null;
          if (agencyKey) {
            refreshed = agencyKey;
          }
        }
        if (refreshed) {
          try {
            token = await resolveLocationToken(refreshed, venue.ghl_location_id);
          } catch (resolveErr) {
            const rmsg = resolveErr instanceof Error ? resolveErr.message : String(resolveErr);
            throw new Error(`GHL auth failed (agency key cannot be exchanged for location ${venue.ghl_location_id}): ${rmsg}`);
          }
          pageData = await fetchContactPage(token, venue.ghl_location_id, startAfter, startAfterId);
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }

    if (pageData.contacts.length === 0) break;
    counts.fetched += pageData.contacts.length;

    for (const c of pageData.contacts) {
      try {
        const r = await upsertContact(venueId, c);
        if (r.kind === 'created')      counts.created++;
        else if (r.kind === 'updated') counts.updated++;
        else if (r.kind === 'linked')  counts.linked++;
        else                           counts.errors++;
      } catch (err) {
        counts.errors++;
        console.error('[ghl-contacts-sync] upsert error', c.id, err);
      }
    }

    if (!pageData.nextStartAfter && !pageData.nextStartAfterId) break;
    startAfter   = pageData.nextStartAfter;
    startAfterId = pageData.nextStartAfterId;
  }

  // Mark the venue as having been synced.
  await supabaseAdmin
    .from('venues')
    .update({ ghl_contacts_synced_at: new Date().toISOString() })
    .eq('id', venueId);

  return counts;
}

/**
 * Sync a single GHL contact (used by ContactCreate / ContactUpdate webhooks).
 * Returns true if the contact was upserted, false if anything went wrong.
 */
export async function syncSingleGhlContact(
  locationId: string,
  contactId: string,
): Promise<boolean> {
  const { data: venueRaw } = await supabaseAdmin
    .from('venues')
    .select('id, ghl_location_id, ghl_access_token, ghl_refresh_token, ghl_connected')
    .eq('ghl_location_id', locationId)
    .maybeSingle();
  if (!venueRaw) return false;
  const venue = venueRaw as VenueRow;

  let token: string;
  try {
    token = await ensureLocationToken({
      id: venue.id,
      ghl_location_id: locationId,
      ghl_access_token: venue.ghl_access_token,
    });
  } catch {
    return false;
  }
  if (classifyToken(token) === 'v2-oauth') {
    try {
      token = await resolveLocationToken(token, locationId);
    } catch {
      // fall through and try the call anyway
    }
  }

  try {
    let result: { contact?: GhlContact };
    try {
      result = await ghlRequest(`/contacts/${contactId}`, token, { locationId }) as {
        contact?: GhlContact;
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      // 401 → try agency key fallback for legacy clients
      if (/\b401\b/.test(msg)) {
        const agencyKey = process.env.GHL_AGENCY_API_KEY || process.env.GHL_PRIVATE_KEY || null;
        if (agencyKey) {
          token = await resolveLocationToken(agencyKey, locationId);
          result = await ghlRequest(`/contacts/${contactId}`, token, { locationId }) as {
            contact?: GhlContact;
          };
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }
    const c = result.contact;
    if (!c?.id) return false;
    const r = await upsertContact(venue.id, c);
    if (r.kind !== 'error') {
      // Apply ghl_synced system tag whenever a contact is created or linked (fire-and-forget)
      const contactEmail = (c.email ?? '').trim().toLowerCase();
      if (contactEmail && (r.kind === 'created' || r.kind === 'linked')) {
        void import('@/lib/system-tags').then(({ applySystemTagByEmail, ensureSystemTagsForVenue }) =>
          ensureSystemTagsForVenue(venue.id)
            .then(() => applySystemTagByEmail(venue.id, contactEmail, 'ghl_synced'))
            .catch(() => {}),
        );
      }
    }
    return r.kind !== 'error';
  } catch (err) {
    console.error('[ghl-contacts-sync] single contact fetch failed', contactId, err);
    return false;
  }
}

/**
 * Cron entry point. Syncs every GHL-connected venue whose last sync is
 * older than `staleHours` (or has never been synced).
 */
export async function syncAllGhlConnectedVenues(opts: { staleHours?: number; maxVenues?: number } = {}): Promise<{
  venuesProcessed: number;
  totals: SyncCounts;
  perVenue: Array<{ venueId: string; counts: SyncCounts | null; error?: string }>;
}> {
  const { staleHours = 6, maxVenues = 25 } = opts;
  const cutoffIso = new Date(Date.now() - staleHours * 3_600_000).toISOString();

  const { data, error } = await supabaseAdmin
    .from('venues')
    .select('id, ghl_contacts_synced_at')
    .eq('ghl_connected', true)
    .or(`ghl_contacts_synced_at.is.null,ghl_contacts_synced_at.lt.${cutoffIso}`)
    .order('ghl_contacts_synced_at', { ascending: true, nullsFirst: true })
    .limit(maxVenues);

  if (error) {
    console.error('[ghl-contacts-sync] failed to list venues', error);
    return { venuesProcessed: 0, totals: { fetched: 0, created: 0, updated: 0, linked: 0, errors: 0 }, perVenue: [] };
  }

  const perVenue: Array<{ venueId: string; counts: SyncCounts | null; error?: string }> = [];
  const totals: SyncCounts = { fetched: 0, created: 0, updated: 0, linked: 0, errors: 0 };

  for (const row of data ?? []) {
    const venueId = (row as { id: string }).id;
    try {
      const c = await syncGhlContactsForVenue(venueId);
      perVenue.push({ venueId, counts: c });
      totals.fetched += c.fetched;
      totals.created += c.created;
      totals.updated += c.updated;
      totals.linked  += c.linked;
      totals.errors  += c.errors;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      console.error('[ghl-contacts-sync] venue failed', venueId, msg);
      perVenue.push({ venueId, counts: null, error: msg });
    }
  }

  return { venuesProcessed: perVenue.length, totals, perVenue };
}
