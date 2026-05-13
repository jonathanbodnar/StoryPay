/**
 * Push a StoryVenue contact (`venue_customers` row) to GoHighLevel.
 *
 * Philosophy: after the initial GHL → SaaS sync, StoryVenue becomes the
 * system of record for contacts. Every edit users make in the StoryVenue UI
 * (phone, name, email, etc.) flows back to GHL automatically — so by the
 * time anyone tries to send an SMS, GHL already has the up-to-date phone
 * number and the send succeeds without surprise "Missing phone number" 422s.
 *
 * This helper is intentionally best-effort and never throws:
 *   - Returns `{ ok: true }` when GHL accepted the write (or the venue isn't
 *     connected so there's nothing to do).
 *   - Returns `{ ok: false, reason }` on any failure. Callers can log this
 *     but should not surface the failure to end-users — the local DB has
 *     already been updated.
 *
 * Strategy:
 *   1. Resolve the venue's GHL token (legacy v1 location key or v2 PIT).
 *   2. If we don't already have a `ghl_contact_id`, call `findOrCreateContact`
 *      to look up / create one in GHL, then persist the id back.
 *   3. GET the current GHL contact, merge our SaaS fields on top, PUT back
 *      the full object. We use the GET-then-PUT pattern (rather than a
 *      partial PUT) because v2's PUT validators reject some partial bodies
 *      and can clear unspecified fields on certain account configurations.
 *   4. Verify the write took by re-reading the contact.
 */

import { supabaseAdmin } from '@/lib/supabase';
import {
  classifyToken,
  findOrCreateContact,
  ghlRequest,
  normalizePhone,
  resolveLocationToken,
} from '@/lib/ghl';
import { ensureLocationToken } from '@/lib/ghl-auth';

export type PushResult =
  | { ok: true; ghlContactId: string | null; updated: boolean; reason?: string }
  | { ok: false; reason: string };

interface VenueCustomerRow {
  id: string;
  venue_id: string;
  first_name: string | null;
  last_name: string | null;
  customer_email: string | null;
  phone: string | null;
  ghl_contact_id: string | null;
}

interface VenueRow {
  id: string;
  ghl_location_id: string | null;
  ghl_access_token: string | null;
  ghl_connected: boolean | null;
}

/** Fields GHL manages itself — never echo them back on PUT. */
const GHL_SYSTEM_FIELDS = new Set([
  'id',
  'locationId',
  'dateAdded',
  'dateUpdated',
  'createdBy',
  'lastSessionActivityAt',
  'attributionSource',
  'lastAttributionSource',
  'contactName',
  'fullNameLowerCase',
  'companyName',
  'source',
]);

function isPlaceholderEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return /@(?:ghl-import\.storyvenue|ghl-sms\.storypay)\.placeholder$/i.test(email);
}

/**
 * Push the given venue_customer to GHL. Idempotent and safe to call multiple
 * times in a row — GHL accepts the same PUT body without side effects.
 */
export async function pushVenueCustomerToGhl(params: {
  venueId: string;
  venueCustomerId: string;
  /** Optional label that shows up in [ghl-push] logs for traceability. */
  reason?: string;
}): Promise<PushResult> {
  const { venueId, venueCustomerId, reason } = params;
  const tag = reason ? `[ghl-push:${reason}]` : '[ghl-push]';

  const { data: vcRow } = await supabaseAdmin
    .from('venue_customers')
    .select('id, venue_id, first_name, last_name, customer_email, phone, ghl_contact_id')
    .eq('id', venueCustomerId)
    .eq('venue_id', venueId)
    .maybeSingle();

  const vc = vcRow as VenueCustomerRow | null;
  if (!vc) {
    console.log(`${tag} skip: venue_customer not found`, { venueId, venueCustomerId });
    return { ok: false, reason: 'venue_customer_not_found' };
  }

  const { data: venueRow } = await supabaseAdmin
    .from('venues')
    .select('id, ghl_location_id, ghl_access_token, ghl_connected')
    .eq('id', venueId)
    .maybeSingle();
  const venue = venueRow as VenueRow | null;

  if (!venue?.ghl_connected || !venue.ghl_location_id) {
    console.log(`${tag} skip: venue not connected to GHL`, {
      venueId,
      connected: venue?.ghl_connected,
      locationId: venue?.ghl_location_id,
    });
    return { ok: true, ghlContactId: vc.ghl_contact_id, updated: false, reason: 'venue_not_connected' };
  }

  let token: string;
  try {
    token = await ensureLocationToken({
      id: venue.id,
      ghl_location_id: venue.ghl_location_id,
      ghl_access_token: venue.ghl_access_token,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`${tag} ensureLocationToken failed: ${msg}`);
    return { ok: false, reason: `token_error: ${msg.slice(0, 200)}` };
  }

  const phoneE164 = normalizePhone(vc.phone) ?? null;
  const firstName = (vc.first_name ?? '').trim();
  const lastName = (vc.last_name ?? '').trim();
  const emailRaw = (vc.customer_email ?? '').trim();
  // Don't push placeholder emails back to GHL — they're sentinel values from
  // the original sync (we never want them to become canonical in either system).
  const emailForGhl = isPlaceholderEmail(emailRaw) ? '' : emailRaw;

  const locationId = venue.ghl_location_id;
  let ghlContactId = vc.ghl_contact_id;

  // 1. Resolve or create the GHL contact id.
  if (!ghlContactId) {
    const identifier = emailForGhl || phoneE164;
    if (!identifier) {
      console.log(`${tag} skip: no email or phone to push`, { venueCustomerId });
      return { ok: true, ghlContactId: null, updated: false, reason: 'no_identifier' };
    }
    try {
      ghlContactId = await findOrCreateContact(token, locationId, {
        email: emailForGhl || undefined,
        phone: phoneE164 ?? undefined,
        firstName,
        lastName,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`${tag} findOrCreateContact failed: ${msg}`);
      return { ok: false, reason: `find_or_create_failed: ${msg.slice(0, 200)}` };
    }
    if (ghlContactId) {
      await supabaseAdmin
        .from('venue_customers')
        .update({ ghl_contact_id: ghlContactId })
        .eq('id', venueCustomerId)
        .eq('venue_id', venueId);
      console.log(`${tag} linked ghl_contact_id=${ghlContactId} to venue_customer=${venueCustomerId}`);
    } else {
      return { ok: false, reason: 'no_contact_id_returned' };
    }
  }

  // 2. Always do a GET-then-PUT for the merge. Resolve v2 token first.
  const v2Token = await resolveLocationToken(token, locationId);
  const isV1 = classifyToken(token) === 'v1';

  let existing: Record<string, unknown> = {};
  try {
    const probe = (await ghlRequest(
      `/contacts/${encodeURIComponent(ghlContactId)}`,
      v2Token,
      { locationId },
    )) as { contact?: Record<string, unknown> } & Record<string, unknown>;
    existing = (probe.contact ?? probe) as Record<string, unknown>;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`${tag} GET /contacts/${ghlContactId} failed: ${msg}`);
    // Continue — we'll do a forced PUT below with our SaaS values.
  }

  // Build the merged PUT body. Start with everything GHL has, drop their
  // system-managed fields, then layer our SaaS values on top.
  const putBody: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(existing)) {
    if (GHL_SYSTEM_FIELDS.has(k)) continue;
    if (v === undefined || v === null) continue;
    putBody[k] = v;
  }
  if (firstName) putBody.firstName = firstName;
  if (lastName) putBody.lastName = lastName;
  if (emailForGhl) putBody.email = emailForGhl;
  if (phoneE164) putBody.phone = phoneE164;
  putBody.locationId = locationId;

  try {
    await ghlRequest(`/contacts/${encodeURIComponent(ghlContactId)}`, v2Token, {
      method: 'PUT',
      body: putBody,
      locationId,
    });
    console.log(`${tag} PUT /contacts/${ghlContactId} ok`, {
      sent: {
        firstName: putBody.firstName,
        lastName: putBody.lastName,
        email: putBody.email,
        phone: putBody.phone,
      },
      isV1,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`${tag} PUT /contacts/${ghlContactId} failed: ${msg}`);
    return { ok: false, reason: `put_failed: ${msg.slice(0, 200)}` };
  }

  // 3. Verify the write (eventual consistency — wait briefly).
  if (phoneE164) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      const verify = (await ghlRequest(
        `/contacts/${encodeURIComponent(ghlContactId)}`,
        v2Token,
        { locationId },
      )) as { contact?: { phone?: string | null }; phone?: string | null };
      const got = verify.contact?.phone ?? verify.phone ?? null;
      const normalizedGot = normalizePhone(got);
      const match = normalizedGot === phoneE164;
      console.log(`${tag} verify phone got=${got} expected=${phoneE164} match=${match}`);
    } catch {
      /* verification is best-effort */
    }
  }

  return { ok: true, ghlContactId, updated: true };
}

/**
 * Fire-and-forget variant. Use from request handlers where you don't want
 * to block the HTTP response on a GHL round-trip. Errors are logged but
 * never thrown.
 */
export function schedulePushVenueCustomerToGhl(params: {
  venueId: string;
  venueCustomerId: string;
  reason?: string;
}): void {
  void pushVenueCustomerToGhl(params).catch((e) => {
    console.error('[ghl-push] background push threw', e);
  });
}
