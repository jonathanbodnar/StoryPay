import { supabaseAdmin } from '@/lib/supabase';
import { normalizePhone } from '@/lib/ghl';

/** US carrier standard opt-out keywords (case-insensitive, single-word or phrase). */
const SMS_OPT_OUT_KEYWORDS = new Set([
  'stop',
  'stopall',
  'unsubscribe',
  'cancel',
  'end',
  'quit',
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

const PLACEHOLDER_SMS_EMAIL = '@ghl-sms.storypay.placeholder';

/**
 * Set SMS DND on venue_customer and matching leads (same venue, email or phone match).
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
    .select('id, customer_email, phone')
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
}

const CLEAR_SMS_DND = {
  sms_dnd: false,
  sms_dnd_at: null as string | null,
  sms_dnd_source: null as string | null,
};

/** Clear SMS DND on matching leads (after venue owner clears it on the profile). */
export async function clearSmsDndForVenueCustomer(params: {
  venueId: string;
  venueCustomerId: string;
}): Promise<void> {
  const { venueId, venueCustomerId } = params;

  const { data: vc } = await supabaseAdmin
    .from('venue_customers')
    .select('customer_email, phone')
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
}
