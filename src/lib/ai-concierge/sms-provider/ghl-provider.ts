/**
 * GHL SMS provider — wraps the existing `src/lib/ghl.ts` `sendSms` function
 * with AI-Concierge-specific lookup logic.
 *
 * Per send:
 *   1. Load venue (GHL tokens + location_id)
 *   2. Load lead (phone, email, name, sms_dnd flag)
 *   3. Resolve the GHL contact id via the email-matched venue_customer row,
 *      falling back to `findOrCreateContact` when missing
 *   4. Call ghl.sendSms()
 *   5. Map the result to our generic SmsSendResult / SmsSendOutcome enum
 *
 * Errors are caught and classified into the outcome enum so the send cron
 * can decide whether to retry.
 */

import { supabaseAdmin } from '@/lib/supabase';
import {
  sendSms as ghlSendSms,
  findOrCreateContact,
  getGhlAgencyKey,
  normalizePhone,
} from '@/lib/ghl';
import { ensureLocationToken } from '@/lib/ghl-auth';
import type {
  SmsProvider,
  SmsSendInput,
  SmsSendOutcome,
  SmsSendResult,
} from './types';

interface VenueAuthRow {
  id:                 string;
  ghl_access_token:   string | null;
  ghl_refresh_token:  string | null;
  ghl_location_id:    string | null;
  ghl_connected:      boolean | null;
}

interface LeadRow {
  id:         string;
  email:      string | null;
  phone:      string | null;
  first_name: string | null;
  last_name:  string | null;
  sms_dnd:    boolean | null;
}

interface VenueCustomerLookupRow {
  id:               string;
  ghl_contact_id:   string | null;
  sms_dnd:          boolean | null;
}

export const ghlSmsProvider: SmsProvider = {
  key:   'ghl',
  label: 'GoHighLevel (legacy messaging)',

  async send(input: SmsSendInput): Promise<SmsSendResult> {
    const { venueId, leadId, message } = input;
    if (!message?.trim()) {
      return errResult('permanent_error', 'Empty message body');
    }

    // 1. Venue
    const { data: venueRow, error: vErr } = await supabaseAdmin
      .from('venues')
      .select('id, ghl_access_token, ghl_refresh_token, ghl_location_id, ghl_connected')
      .eq('id', venueId)
      .maybeSingle();
    if (vErr) return errResult('transient_error', `Venue lookup failed: ${vErr.message}`);
    const venue = venueRow as VenueAuthRow | null;
    if (!venue) return errResult('permanent_error', 'Venue not found');
    if (!venue.ghl_location_id) {
      return errResult('auth_error', 'Venue has no GHL location_id — cannot send via GHL');
    }
    const locationId = venue.ghl_location_id;
    let accessToken: string;
    try {
      accessToken = await ensureLocationToken({
        id: venue.id,
        ghl_location_id: locationId,
        ghl_access_token: venue.ghl_access_token,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'No working GHL token';
      return errResult('auth_error', msg);
    }

    // 2. Lead
    const { data: leadRow, error: lErr } = await supabaseAdmin
      .from('leads')
      .select('id, email, phone, first_name, last_name, sms_dnd')
      .eq('id', leadId)
      .eq('venue_id', venueId)
      .maybeSingle();
    if (lErr) return errResult('transient_error', `Lead lookup failed: ${lErr.message}`);
    const lead = leadRow as LeadRow | null;
    if (!lead) return errResult('permanent_error', `Lead ${leadId} not found for venue ${venueId}`);
    if (lead.sms_dnd) return errResult('dnd', 'Lead has SMS DND set on the lead row');

    const phone = normalizePhone(lead.phone);
    if (!phone) return errResult('invalid_phone', 'Lead has no usable phone number');

    // 3. Resolve GHL contact id (prefer existing venue_customer row matched by email)
    // 4. Send
    // Both steps are wrapped with a 401 → agency key fallback for legacy clients.
    const attempt = async (token: string): Promise<SmsSendResult> => {
      let ghlContactId: string | null = null;
      if (lead.email) {
        const { data: vcRow } = await supabaseAdmin
          .from('venue_customers')
          .select('id, ghl_contact_id, sms_dnd')
          .eq('venue_id', venueId)
          .ilike('customer_email', lead.email.trim())
          .maybeSingle();
        const vc = vcRow as VenueCustomerLookupRow | null;
        if (vc?.sms_dnd) return errResult('dnd', 'Venue customer has SMS DND set');
        if (vc?.ghl_contact_id) ghlContactId = vc.ghl_contact_id;
      }

      if (!ghlContactId) {
        const created = await findOrCreateContact(token, locationId, {
          email:     lead.email      ?? undefined,
          phone:     phone,
          firstName: lead.first_name ?? undefined,
          lastName:  lead.last_name  ?? undefined,
        });
        if (!created) {
          return errResult('permanent_error', 'GHL findOrCreateContact returned null');
        }
        ghlContactId = created;
      }

      const res = await ghlSendSms(token, locationId, ghlContactId, message);
      return {
        ok:                true,
        outcome:           'sent',
        providerMessageId: extractMessageId(res),
      };
    };

    try {
      return await attempt(accessToken);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown GHL error';
      // 401 → retry with agency key (legacy clients with stale per-venue token)
      if (/\b401\b/.test(msg) || /unauthor/i.test(msg)) {
        const agencyKey = getGhlAgencyKey();
        if (agencyKey && agencyKey !== accessToken) {
          try {
            return await attempt(agencyKey);
          } catch (e2) {
            const msg2 = e2 instanceof Error ? e2.message : 'unknown GHL error';
            return errResult(classifyGhlError(msg2), msg2);
          }
        }
      }
      return errResult(classifyGhlError(msg), msg);
    }
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────

function errResult(outcome: SmsSendOutcome, error: string): SmsSendResult {
  return { ok: false, outcome, error };
}

/**
 * Pull a message id out of GHL's response, which can take a few shapes:
 *   { messageId }, { data: { messageId } }, { data: { id } }
 */
function extractMessageId(res: unknown): string | undefined {
  if (!res || typeof res !== 'object') return undefined;
  const r = res as Record<string, unknown>;
  if (typeof r.messageId === 'string' && r.messageId) return r.messageId;
  if (typeof r.id === 'string' && r.id) return r.id;
  const data = r.data;
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    if (typeof d.messageId === 'string' && d.messageId) return d.messageId;
    if (typeof d.id        === 'string' && d.id)        return d.id;
  }
  return undefined;
}

/**
 * Map GHL error strings to our generic outcome enum.
 *
 * GHL's messages aren't standardized so we pattern-match the most common
 * cases and default to `permanent_error` for anything we don't recognize.
 */
function classifyGhlError(msg: string): SmsSendOutcome {
  const lower = msg.toLowerCase();

  // Auth issues
  if (lower.includes('unauthor') ||
      lower.includes('forbidden') ||
      lower.includes('invalid token') ||
      lower.includes('expired token') ||
      lower.includes('401') ||
      lower.includes('403')) {
    return 'auth_error';
  }

  // DND / opt-out
  if (lower.includes('dnd') ||
      lower.includes('opted out') ||
      lower.includes('opt-out') ||
      lower.includes('do not disturb')) {
    return 'dnd';
  }

  // Phone validity
  if (lower.includes('invalid phone') ||
      lower.includes('phone number') ||
      lower.includes('e.164')) {
    return 'invalid_phone';
  }

  // Transient — retryable
  if (lower.includes('timeout') ||
      lower.includes('econnreset') ||
      lower.includes('econnrefused') ||
      lower.includes('socket') ||
      lower.includes('rate limit') ||
      lower.includes('429') ||
      /\b5\d\d\b/.test(lower)) {  // 500-599 status codes
    return 'transient_error';
  }

  return 'permanent_error';
}
