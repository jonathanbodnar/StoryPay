/**
 * One-off (Sep 30, 2026): honor STOP texts that arrived before StoryVenue
 * handled them itself (audit item #4).
 *
 * Until now, texts arriving through the CRM sync never ran our STOP handling;
 * blocking relied on the CRM noticing. So:
 *   - contacts whose STOP the CRM missed are still textable (Union + Social's
 *     "Stop." on Sep 26), and
 *   - leads of contacts who texted STOP still say they consented to texts.
 *
 * For every inbound text that is an opt-out (lib/sms-compliance) and is not
 * followed by a later opt-in from the same contact, this:
 *   - sets do-not-text on the contact here and in the CRM if it isn't already
 *     (applySmsDndForVenueCustomer, the same path a live STOP takes), and
 *   - marks the contact's leads as not consented to texts.
 * It does not move pipeline stages or tags; that only happens for live STOPs.
 *
 * Usage (production):
 *   railway run --service "StoryVenue Backend" -- npx tsx --tsconfig ./tsconfig.json scripts/backfill-past-stop-texts.ts          # dry run
 *   railway run --service "StoryVenue Backend" -- npx tsx --tsconfig ./tsconfig.json scripts/backfill-past-stop-texts.ts --apply
 */

import { supabaseAdmin } from '@/lib/supabase';
import { isSmsOptInKeyword, isSmsOptOutKeyword, applySmsDndForVenueCustomer } from '@/lib/sms-compliance';
import { recordLeadSmsConsent } from '@/lib/sms-consent';
import { normalizePhone } from '@/lib/ghl';

async function main() {
  const apply = process.argv.includes('--apply');

  // Every inbound text from a contact, oldest first, in pages.
  type Msg = { body: string; created_at: string; thread_id: string };
  const msgs: Msg[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('conversation_messages')
      .select('body, created_at, thread_id')
      .eq('channel', 'sms')
      .eq('sender_kind', 'contact')
      .order('created_at', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    msgs.push(...((data ?? []) as Msg[]));
    if (!data || data.length < 1000) break;
  }

  // The last opt-out / opt-in word per thread decides.
  const lastWord = new Map<string, { kind: 'out' | 'in'; at: string }>();
  for (const m of msgs) {
    if (isSmsOptOutKeyword(m.body)) lastWord.set(m.thread_id, { kind: 'out', at: m.created_at });
    else if (isSmsOptInKeyword(m.body)) lastWord.set(m.thread_id, { kind: 'in', at: m.created_at });
  }
  const optedOutThreads = [...lastWord.entries()].filter(([, v]) => v.kind === 'out').map(([id]) => id);
  console.log(`inbound texts scanned: ${msgs.length}; threads whose last word is an opt-out: ${optedOutThreads.length}`);

  for (const threadId of optedOutThreads) {
    const { data: t } = await supabaseAdmin
      .from('conversation_threads')
      .select('venue_id, venue_customer_id')
      .eq('id', threadId)
      .maybeSingle();
    const th = t as { venue_id: string; venue_customer_id: string | null } | null;
    if (!th?.venue_customer_id) continue;
    const { data: vcRow } = await supabaseAdmin
      .from('venue_customers')
      .select('id, venue_id, customer_email, phone, sms_dnd')
      .eq('id', th.venue_customer_id)
      .maybeSingle();
    const vc = vcRow as { id: string; venue_id: string; customer_email: string | null; phone: string | null; sms_dnd: boolean | null } | null;
    if (!vc) continue;

    // Leads of this contact: by email, then by phone.
    const leadIds = new Set<string>();
    const email = (vc.customer_email ?? '').trim().toLowerCase();
    if (email && !email.endsWith('@ghl-sms.storypay.placeholder')) {
      const { data } = await supabaseAdmin.from('leads').select('id').eq('venue_id', vc.venue_id).ilike('email', email);
      for (const r of data ?? []) leadIds.add((r as { id: string }).id);
    }
    const phone = normalizePhone(vc.phone);
    if (phone) {
      const { data } = await supabaseAdmin.from('leads').select('id, phone').eq('venue_id', vc.venue_id).not('phone', 'is', null);
      for (const r of (data ?? []) as Array<{ id: string; phone: string | null }>) {
        if (normalizePhone(r.phone) === phone) leadIds.add(r.id);
      }
    }
    const { data: leadRows } = leadIds.size
      ? await supabaseAdmin.from('leads').select('id, sms_consent, sms_dnd').in('id', [...leadIds])
      : { data: [] };
    const stillConsented = ((leadRows ?? []) as Array<{ id: string; sms_consent: boolean | null }>).filter((l) => l.sms_consent !== false);

    const needsDnd = vc.sms_dnd !== true;
    if (!needsDnd && !stillConsented.length) continue;
    console.log(`${apply ? 'FIX ' : 'WOULD FIX '}contact ${vc.id} (venue ${vc.venue_id}): ${needsDnd ? 'set do-not-text; ' : ''}${stillConsented.length} lead(s) to no consent`);
    if (!apply) continue;

    if (needsDnd) await applySmsDndForVenueCustomer({ venueId: vc.venue_id, venueCustomerId: vc.id, source: 'inbound_stop_keyword' });
    for (const l of stillConsented) await recordLeadSmsConsent({ leadId: l.id, allowed: false, source: 'inbound_stop_keyword' });
  }
  console.log(apply ? 'done' : 'dry run only; pass --apply to make the changes');
}

main().catch((e) => { console.error(e); process.exit(1); });
