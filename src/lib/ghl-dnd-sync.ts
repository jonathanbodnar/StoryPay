/**
 * GHL → StoryVenue DND polling sync.
 *
 * WHY THIS EXISTS: GHL contact DND is set per-channel (SMS, Email, Call,
 * Inbound). StoryVenue needs those flags in venue_customers so the messaging
 * layer can enforce them without hitting GHL every time a message is sent.
 *
 * Design decisions:
 *   - One-way sync: GHL is the source of truth for DND. StoryVenue never clears
 *     a DND flag based on GHL state — if GHL doesn't have the channel marked
 *     active, we leave the existing StoryVenue value untouched. This prevents
 *     a GHL polling gap from accidentally re-enabling messaging to a contact
 *     who opted out inside StoryVenue.
 *   - Per-channel, not blanket: each of sms_dnd, conversation_dnd_email,
 *     conversation_dnd_calls, conversation_dnd_inbound_sms, and
 *     conversation_dnd_all is derived independently from GHL's dndSettings.
 *   - Raw settings preserved: ghl_dnd_settings and ghl_inbound_dnd_settings
 *     are always written so the DND management UI has the authoritative GHL
 *     object to display and diff against.
 *
 * Invoked from runGhlInboundSyncCron (every 60 s) for each GHL-connected venue.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { ghlRequest, resolveLocationToken } from '@/lib/ghl';
import { ghlDndToConversationFlags } from '@/app/api/venue-customers/[id]/dnd/route';
import { logError } from '@/lib/error-log';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Subset of the venue row the cron passes in. */
export interface GhlVenueForDnd {
  id: string;
  name: string;
  locationId: string;
  token: string;
}

type GhlDndChannelStatus = 'active' | 'inactive' | string;
interface GhlDndChannelEntry {
  status?: GhlDndChannelStatus;
  message?: string;
  code?: string;
}
type GhlDndSettings = Partial<
  Record<'Call' | 'Email' | 'SMS' | 'WhatsApp' | 'GMB' | 'FB', GhlDndChannelEntry>
>;
interface GhlInboundDndSettings {
  all?: GhlDndChannelEntry;
}

interface GhlContactDnd {
  id: string;
  dnd?: boolean | null;
  dndSettings?: GhlDndSettings | null;
  inboundDndSettings?: GhlInboundDndSettings | null;
}

interface ContactPage {
  contacts: GhlContactDnd[];
  nextStartAfter: string | null;
  nextStartAfterId: string | null;
}

export interface GhlDndSyncResult {
  contactsScanned: number;
  contactsUpdated: number;
  errors: number;
}

// ── GHL pagination ────────────────────────────────────────────────────────────

const DND_PAGE_SIZE = 100;

async function fetchDndContactPage(
  token: string,
  locationId: string,
  startAfter: string | null,
  startAfterId: string | null,
): Promise<ContactPage> {
  const qs = new URLSearchParams({ locationId, limit: String(DND_PAGE_SIZE) });
  if (startAfter)   qs.set('startAfter',   startAfter);
  if (startAfterId) qs.set('startAfterId', startAfterId);

  // Request only the DND-relevant fields to keep payloads small.
  qs.set('fields', 'id,dnd,dndSettings,inboundDndSettings');

  const result = await ghlRequest(`/contacts/?${qs.toString()}`, token, { locationId }) as {
    contacts?: GhlContactDnd[];
    meta?: {
      startAfter?: string | number | null;
      startAfterId?: string | null;
    };
  };

  const contacts = result.contacts ?? [];
  const meta = result.meta ?? {};
  return {
    contacts,
    nextStartAfter:   meta.startAfter   ? String(meta.startAfter) : null,
    nextStartAfterId: meta.startAfterId ?? null,
  };
}

// ── Per-contact update ────────────────────────────────────────────────────────

/**
 * Build a partial update object containing only the DND fields where GHL
 * says the channel is active. Fields where GHL is inactive/absent are
 * intentionally omitted — Supabase will leave the existing column value
 * untouched, preserving any flags the venue operator set manually.
 */
function buildDndUpdate(
  c: GhlContactDnd,
  nowIso: string,
): Record<string, unknown> | null {
  const flags = ghlDndToConversationFlags(
    (c.dndSettings ?? null) as Record<string, { status?: string } | null | undefined> | null,
    c.inboundDndSettings ?? null,
  );

  // Master DND: GHL's top-level `dnd` boolean means "all channels blocked".
  const masterDnd = c.dnd === true;

  // At minimum always freshen the raw JSON blobs so the UI reflects GHL state.
  const update: Record<string, unknown> = {
    ghl_dnd_settings:         c.dndSettings         ?? null,
    ghl_inbound_dnd_settings: c.inboundDndSettings  ?? null,
  };

  // Only set boolean columns to true — never set to false from this poller.
  if (flags.sms_dnd) {
    update.sms_dnd        = true;
    update.sms_dnd_source = 'ghl_sync';
    update.sms_dnd_at     = nowIso;
  }
  if (flags.conversation_dnd_email)        update.conversation_dnd_email        = true;
  if (flags.conversation_dnd_calls)        update.conversation_dnd_calls        = true;
  if (flags.conversation_dnd_inbound_sms)  update.conversation_dnd_inbound_sms  = true;
  if (flags.conversation_dnd_all || masterDnd) update.conversation_dnd_all      = true;

  return update;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Scan all GHL contacts for `venue`, check their DND settings, and propagate
 * any active DND flags into venue_customers. Capped at `maxContacts` per run
 * to bound GHL API usage within the 60-second cron window.
 */
export async function syncGhlDndForVenue(
  venue: GhlVenueForDnd,
  opts: { maxContacts?: number } = {},
): Promise<GhlDndSyncResult> {
  const maxContacts = Math.max(1, Math.min(5000, opts.maxContacts ?? 500));
  const result: GhlDndSyncResult = { contactsScanned: 0, contactsUpdated: 0, errors: 0 };

  let token: string;
  try {
    token = await resolveLocationToken(venue.token, venue.locationId);
  } catch {
    token = venue.token;
  }

  const nowIso = new Date().toISOString();

  let startAfter:   string | null = null;
  let startAfterId: string | null = null;

  while (result.contactsScanned < maxContacts) {
    let page: ContactPage;
    try {
      page = await fetchDndContactPage(token, venue.locationId, startAfter, startAfterId);
    } catch (e) {
      console.error('[ghl-dnd-sync] fetchDndContactPage failed', {
        venueId: venue.id,
        error: e instanceof Error ? e.message : String(e),
      });
      result.errors++;
      break;
    }

    if (page.contacts.length === 0) break;

    // Batch: collect contacts that have any DND data (skip pure no-dnd rows to
    // avoid touching every contact record on every poll).
    const toUpdate: Array<{ ghl_contact_id: string; update: Record<string, unknown> }> = [];

    for (const c of page.contacts) {
      result.contactsScanned++;
      if (result.contactsScanned > maxContacts) break;

      const hasDndData =
        c.dnd === true ||
        (c.dndSettings && Object.values(c.dndSettings).some((ch) => ch?.status === 'active')) ||
        c.inboundDndSettings?.all?.status === 'active';

      // Always freshen the raw blobs for contacts that *have* any dnd object at all,
      // even if no channel is active (so the UI can show "no DND set in GHL").
      const hasAnyDndObject = c.dnd != null || c.dndSettings != null || c.inboundDndSettings != null;
      if (!hasAnyDndObject) continue;

      const update = buildDndUpdate(c, nowIso);
      if (update) toUpdate.push({ ghl_contact_id: c.id, update });
    }

    // Sequential individual updates — GHL contact IDs are the match key.
    for (const { ghl_contact_id, update } of toUpdate) {
      try {
        const { error } = await supabaseAdmin
          .from('venue_customers')
          .update(update)
          .eq('venue_id', venue.id)
          .eq('ghl_contact_id', ghl_contact_id);

        if (error) {
          console.warn('[ghl-dnd-sync] update failed', { venueId: venue.id, ghl_contact_id, error: error.message });
          result.errors++;
        } else {
          result.contactsUpdated++;
        }
      } catch (e) {
        console.warn('[ghl-dnd-sync] update threw', { venueId: venue.id, ghl_contact_id, error: e instanceof Error ? e.message : String(e) });
        result.errors++;
      }
    }

    if (!page.nextStartAfter && !page.nextStartAfterId) break;
    startAfter   = page.nextStartAfter;
    startAfterId = page.nextStartAfterId;
  }

  return result;
}

/**
 * Wrapper that records unexpected failures in the Error Log and swallows them
 * so a DND sync failure never crashes the parent inbound sync cron.
 */
export async function syncGhlDndForVenueSafe(
  venue: GhlVenueForDnd,
  opts: { maxContacts?: number } = {},
): Promise<GhlDndSyncResult> {
  try {
    return await syncGhlDndForVenue(venue, opts);
  } catch (e) {
    void logError({
      level: 'error',
      source: 'cron',
      category: 'ghl_dnd_sync',
      message: `GHL DND sync failed for venue "${venue.name}" (${venue.id})`,
      error: e,
      context: { venueId: venue.id, locationId: venue.locationId },
    });
    console.error('[ghl-dnd-sync] unhandled error for venue', venue.id, e);
    return { contactsScanned: 0, contactsUpdated: 0, errors: 1 };
  }
}
