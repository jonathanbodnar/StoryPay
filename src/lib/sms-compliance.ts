import { supabaseAdmin } from '@/lib/supabase';
import { normalizePhone, updateGhlContactDnd, type GhlDndSettings, type GhlInboundDndSettings } from '@/lib/ghl';

/** US carrier standard opt-out keywords (case-insensitive, single-word or phrase). */
const SMS_OPT_OUT_KEYWORDS = new Set([
  'stop',
  'stopall',
  'unsubscribe',
  'cancel',
  'end',
  'quit',
]);

/** US carrier standard opt-in / re-subscribe keywords. */
const SMS_OPT_IN_KEYWORDS = new Set([
  'start',
  'unstop',
  'yes',
  'subscribe',
]);

/**
 * True when the inbound SMS is an opt-out keyword (first word, ignoring punctuation).
 */
export function isSmsOptOutKeyword(body: string): boolean {
  const t = body.trim();
  if (!t) return false;
  const first = (t.split(/\s+/)[0] ?? '').replace(/[^a-zA-Z]/g, '');
  const w = first.toLowerCase();
  return SMS_OPT_OUT_KEYWORDS.has(w);
}

/**
 * True when the inbound SMS is an opt-in / re-subscribe keyword.
 * Per TCPA, START / UNSTOP texts constitute legally-valid re-consent.
 */
export function isSmsOptInKeyword(body: string): boolean {
  const t = body.trim();
  if (!t) return false;
  const first = (t.split(/\s+/)[0] ?? '').replace(/[^a-zA-Z]/g, '');
  const w = first.toLowerCase();
  return SMS_OPT_IN_KEYWORDS.has(w);
}

const PLACEHOLDER_SMS_EMAIL = '@ghl-sms.storypay.placeholder';

/**
 * Push SMS DND state to GHL for a venue_customer that has a ghl_contact_id.
 * Best-effort — failures are logged but don't throw.
 *
 * @param dndActive  true → block SMS in GHL, false → unblock
 */
async function pushSmsDndToGhl(args: {
  venueId: string;
  ghlContactId: string;
  dndActive: boolean;
  existingDndSettings?: GhlDndSettings | null;
  existingInboundDndSettings?: GhlInboundDndSettings | null;
}): Promise<void> {
  const { venueId, ghlContactId, dndActive, existingDndSettings, existingInboundDndSettings } = args;
  try {
    const { data: venue } = await supabaseAdmin
      .from('venues')
      .select('id, ghl_location_id, ghl_access_token, ghl_refresh_token, ghl_connected')
      .eq('id', venueId)
      .maybeSingle();
    if (!venue?.ghl_connected || !venue.ghl_location_id) return;

    const token = await getGhlTokenSafe(venue);
    if (!token) return;

    // Build the SMS channel update — preserve other channels' state from existing settings
    const sms = dndActive
      ? {
          status:  'active',
          message: dndActive ? 'Contact opted out via SMS keyword' : '',
          code:    'inbound_keyword_stop',
        }
      : { status: 'inactive', message: '', code: '' };

    const next: GhlDndSettings = {
      ...(existingDndSettings ?? {}),
      SMS: sms as unknown as GhlDndSettings['SMS'],
    };

    // Inbound DND: when blocking SMS, also block inbound SMS so they can't text us back
    let inbound: GhlInboundDndSettings | undefined;
    if (existingInboundDndSettings) {
      inbound = {
        ...existingInboundDndSettings,
        all: {
          status:  dndActive ? 'active' : 'inactive',
          message: dndActive ? 'Contact opted out' : '',
          code:    dndActive ? 'inbound_keyword_stop' : '',
        } as unknown as GhlInboundDndSettings['all'],
      };
    }

    await updateGhlContactDnd(token, venue.ghl_location_id, ghlContactId, next, inbound);
  } catch (err) {
    console.error('[sms-compliance] pushSmsDndToGhl failed:', err);
  }
}

async function getGhlTokenSafe(venue: { ghl_access_token?: string | null; ghl_refresh_token?: string | null }): Promise<string | null> {
  // We only have access_token here; refresh logic lives in getGhlToken which needs a venue id.
  // Use the access token directly — updateGhlContactDnd will handle 401/refresh internally if needed.
  return venue.ghl_access_token ?? null;
}

/**
 * Set SMS DND on venue_customer and matching leads, AND push to GHL so both
 * systems stay in sync. Used for inbound STOP keyword.
 */
export async function applySmsDndForVenueCustomer(params: {
  venueId: string;
  venueCustomerId: string;
  source: string;
}): Promise<void> {
  const { venueId, venueCustomerId, source } = params;
  const now = new Date().toISOString();

  const { data: vc } = await supabaseAdmin
    .from('venue_customers')
    .select('id, customer_email, phone, ghl_contact_id, ghl_dnd_settings, ghl_inbound_dnd_settings')
    .eq('id', venueCustomerId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!vc) return;

  await supabaseAdmin
    .from('venue_customers')
    .update({
      sms_dnd: true,
      sms_dnd_at: now,
      sms_dnd_source: source,
      conversation_dnd_inbound_sms: true,
    })
    .eq('id', venueCustomerId)
    .eq('venue_id', venueId);

  const email = String(vc.customer_email || '').trim().toLowerCase();
  const phoneNorm = normalizePhone(vc.phone as string | null);

  const patch = {
    sms_dnd: true,
    sms_dnd_at: now,
    sms_dnd_source: source,
  };

  if (email && !email.endsWith(PLACEHOLDER_SMS_EMAIL)) {
    await supabaseAdmin.from('leads').update(patch).eq('venue_id', venueId).ilike('email', email);
  }

  if (phoneNorm) {
    const { data: candidates } = await supabaseAdmin
      .from('leads')
      .select('id, phone')
      .eq('venue_id', venueId);
    for (const row of candidates ?? []) {
      if (normalizePhone(row.phone as string | null) === phoneNorm) {
        await supabaseAdmin.from('leads').update(patch).eq('id', row.id as string);
      }
    }
  }

  // Push to GHL so the GHL contact's DND boxes mirror the SaaS state
  if (vc.ghl_contact_id) {
    await pushSmsDndToGhl({
      venueId,
      ghlContactId: vc.ghl_contact_id as string,
      dndActive: true,
      existingDndSettings: vc.ghl_dnd_settings as GhlDndSettings | null,
      existingInboundDndSettings: vc.ghl_inbound_dnd_settings as GhlInboundDndSettings | null,
    });
  }
}

/**
 * Clear SMS DND on venue_customer + matching leads, restore AI state if it
 * was opted_out, AND push the cleared state to GHL. Used for inbound START
 * keyword (legally-valid re-consent under TCPA).
 */
export async function applySmsOptInForVenueCustomer(params: {
  venueId: string;
  venueCustomerId: string;
  source: string;
}): Promise<void> {
  const { venueId, venueCustomerId, source } = params;
  const now = new Date().toISOString();

  const { data: vc } = await supabaseAdmin
    .from('venue_customers')
    .select('id, customer_email, phone, sms_dnd, ghl_contact_id, ghl_dnd_settings, ghl_inbound_dnd_settings')
    .eq('id', venueCustomerId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!vc) return;

  // 1. Clear venue_customer DND
  await supabaseAdmin
    .from('venue_customers')
    .update({
      sms_dnd: false,
      sms_dnd_at: null,
      sms_dnd_source: source,
      conversation_dnd_inbound_sms: false,
      conversation_dnd_all: false,
      updated_at: now,
    })
    .eq('id', venueCustomerId)
    .eq('venue_id', venueId);

  const email = String(vc.customer_email || '').trim().toLowerCase();
  const phoneNorm = normalizePhone(vc.phone as string | null);

  const clearPatch = {
    sms_dnd: false,
    sms_dnd_at: null,
    sms_dnd_source: source,
    updated_at: now,
  };

  // 2. Clear leads matched by email
  const leadIds: string[] = [];
  if (email && !email.endsWith(PLACEHOLDER_SMS_EMAIL)) {
    const { data: emailLeads } = await supabaseAdmin
      .from('leads')
      .select('id')
      .eq('venue_id', venueId)
      .ilike('email', email);
    for (const r of emailLeads ?? []) leadIds.push(r.id as string);
    await supabaseAdmin.from('leads').update(clearPatch).eq('venue_id', venueId).ilike('email', email);
  }

  // 3. Clear leads matched by phone
  if (phoneNorm) {
    const { data: candidates } = await supabaseAdmin
      .from('leads')
      .select('id, phone')
      .eq('venue_id', venueId);
    for (const row of candidates ?? []) {
      if (normalizePhone(row.phone as string | null) === phoneNorm) {
        if (!leadIds.includes(row.id as string)) leadIds.push(row.id as string);
        await supabaseAdmin.from('leads').update(clearPatch).eq('id', row.id as string);
      }
    }
  }

  // 4. Move any opted_out leads back to paused so AI can be re-enabled
  if (leadIds.length > 0) {
    await supabaseAdmin
      .from('leads')
      .update({
        ai_state:    'paused',
        updated_at:  now,
      })
      .in('id', leadIds)
      .eq('ai_state', 'opted_out');
  }

  // 5. Push cleared DND state to GHL so both systems are in sync
  if (vc.ghl_contact_id) {
    await pushSmsDndToGhl({
      venueId,
      ghlContactId: vc.ghl_contact_id as string,
      dndActive: false,
      existingDndSettings: vc.ghl_dnd_settings as GhlDndSettings | null,
      existingInboundDndSettings: vc.ghl_inbound_dnd_settings as GhlInboundDndSettings | null,
    });
  }

  // 6. Apply sms_opted_in system tag (fire-and-forget)
  if (email && !email.endsWith(PLACEHOLDER_SMS_EMAIL)) {
    void import('@/lib/system-tags').then(({ applySystemTagByEmail, ensureSystemTagsForVenue }) =>
      ensureSystemTagsForVenue(venueId)
        .then(() => applySystemTagByEmail(venueId, email, 'sms_opted_in'))
        .catch(() => {}),
    );
  }
}

const CLEAR_SMS_DND = {
  sms_dnd: false,
  sms_dnd_at: null as string | null,
  sms_dnd_source: null as string | null,
};

/**
 * Clear SMS DND on matching leads + push to GHL. Used after venue owner
 * clears DND on the profile (manual override).
 */
export async function clearSmsDndForVenueCustomer(params: {
  venueId: string;
  venueCustomerId: string;
}): Promise<void> {
  const { venueId, venueCustomerId } = params;

  const { data: vc } = await supabaseAdmin
    .from('venue_customers')
    .select('customer_email, phone, ghl_contact_id, ghl_dnd_settings, ghl_inbound_dnd_settings')
    .eq('id', venueCustomerId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!vc) return;

  const email = String(vc.customer_email || '').trim().toLowerCase();
  const phoneNorm = normalizePhone(vc.phone as string | null);

  if (email && !email.endsWith(PLACEHOLDER_SMS_EMAIL)) {
    await supabaseAdmin.from('leads').update(CLEAR_SMS_DND).eq('venue_id', venueId).ilike('email', email);
  }

  if (phoneNorm) {
    const { data: candidates } = await supabaseAdmin
      .from('leads')
      .select('id, phone')
      .eq('venue_id', venueId);
    for (const row of candidates ?? []) {
      if (normalizePhone(row.phone as string | null) === phoneNorm) {
        await supabaseAdmin.from('leads').update(CLEAR_SMS_DND).eq('id', row.id as string);
      }
    }
  }

  // Push cleared DND to GHL — so SaaS-side override mirrors GHL automatically
  if (vc.ghl_contact_id) {
    await pushSmsDndToGhl({
      venueId,
      ghlContactId: vc.ghl_contact_id as string,
      dndActive: false,
      existingDndSettings: vc.ghl_dnd_settings as GhlDndSettings | null,
      existingInboundDndSettings: vc.ghl_inbound_dnd_settings as GhlInboundDndSettings | null,
    });
  }

  // Apply sms_opted_in system tag when DND is cleared (fire-and-forget)
  if (email && !email.endsWith(PLACEHOLDER_SMS_EMAIL)) {
    void import('@/lib/system-tags').then(({ applySystemTagByEmail, ensureSystemTagsForVenue }) =>
      ensureSystemTagsForVenue(venueId)
        .then(() => applySystemTagByEmail(venueId, email, 'sms_opted_in'))
        .catch(() => {}),
    );
  }
}
