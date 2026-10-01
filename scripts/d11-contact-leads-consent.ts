/**
 * One-off (owner's answer to D11, Sep 30, 2026): leads made from CRM contacts
 * before the Sep 30 rule still say they consented to texts (the column
 * default). Switch them to "no texts until they opt in", keeping any lead with
 * a recorded opt-in:
 *   - a consent source on the lead itself,
 *   - a consent proof record (sms_consent_records) for its phone or email,
 *   - another lead at the venue with the same email that came from one of our
 *     forms with a phone (directory, embed, web form, Lead Link), or
 *   - a text the contact sent the venue.
 *
 * Usage (production):
 *   railway run --service "StoryVenue Backend" -- npx tsx --tsconfig ./tsconfig.json scripts/d11-contact-leads-consent.ts          # dry run
 *   railway run --service "StoryVenue Backend" -- npx tsx --tsconfig ./tsconfig.json scripts/d11-contact-leads-consent.ts --apply
 */

import { supabaseAdmin } from '@/lib/supabase';
import { normalizePhone } from '@/lib/ghl';

type Lead = { id: string; venue_id: string; email: string | null; phone: string | null; source: string | null; sms_consent: boolean | null; sms_consent_source: string | null };

async function all<T>(build: (from: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

async function main() {
  const apply = process.argv.includes('--apply');

  const leads = await all<Lead>((from) =>
    supabaseAdmin.from('leads').select('id, venue_id, email, phone, source, sms_consent, sms_consent_source').order('id').range(from, from + 999));
  const proofs = await all<{ venue_id: string; phone: string | null; email: string | null; lead_id: string | null }>((from) =>
    supabaseAdmin.from('sms_consent_records').select('venue_id, phone, email, lead_id').order('id').range(from, from + 999));
  const texts = await all<{ thread_id: string }>((from) =>
    supabaseAdmin.from('conversation_messages').select('thread_id').eq('channel', 'sms').eq('sender_kind', 'contact').order('id').range(from, from + 999));
  const threadIds = [...new Set(texts.map((t) => t.thread_id))];
  const textedContacts = new Set<string>(); // venue|email and venue|phone of contacts who texted
  for (let i = 0; i < threadIds.length; i += 200) {
    const { data: threads } = await supabaseAdmin
      .from('conversation_threads').select('venue_id, venue_customer_id').in('id', threadIds.slice(i, i + 200));
    const vcIds = [...new Set(((threads ?? []) as Array<{ venue_customer_id: string | null }>).map((t) => t.venue_customer_id).filter(Boolean))] as string[];
    if (!vcIds.length) continue;
    const { data: vcs } = await supabaseAdmin.from('venue_customers').select('venue_id, customer_email, phone').in('id', vcIds);
    for (const vc of (vcs ?? []) as Array<{ venue_id: string; customer_email: string | null; phone: string | null }>) {
      if (vc.customer_email) textedContacts.add(`${vc.venue_id}|e|${vc.customer_email.trim().toLowerCase()}`);
      const p = normalizePhone(vc.phone);
      if (p) textedContacts.add(`${vc.venue_id}|p|${p}`);
    }
  }

  const proofKeys = new Set<string>();
  for (const r of proofs) {
    if (r.lead_id) proofKeys.add(`lead|${r.lead_id}`);
    if (r.email) proofKeys.add(`${r.venue_id}|e|${r.email.trim().toLowerCase()}`);
    const p = normalizePhone(r.phone);
    if (p) proofKeys.add(`${r.venue_id}|p|${p}`);
  }
  const FORM_SOURCES = new Set(['directory', 'embed', 'form', 'lead_link', 'marketing_form']);
  const formEmails = new Set<string>();
  for (const l of leads) {
    if (l.source && FORM_SOURCES.has(l.source) && l.email && l.phone) formEmails.add(`${l.venue_id}|e|${l.email.trim().toLowerCase()}`);
  }

  const candidates = leads.filter((l) => l.source === 'contact' && l.sms_consent !== false);
  const keep: Lead[] = [];
  const flip: Lead[] = [];
  for (const l of candidates) {
    const email = (l.email ?? '').trim().toLowerCase();
    const phone = normalizePhone(l.phone);
    const optedIn =
      !!l.sms_consent_source ||
      proofKeys.has(`lead|${l.id}`) ||
      (email && (proofKeys.has(`${l.venue_id}|e|${email}`) || formEmails.has(`${l.venue_id}|e|${email}`) || textedContacts.has(`${l.venue_id}|e|${email}`))) ||
      (phone && (proofKeys.has(`${l.venue_id}|p|${phone}`) || textedContacts.has(`${l.venue_id}|p|${phone}`)));
    (optedIn ? keep : flip).push(l);
  }
  console.log(`contact-made leads marked OK to text: ${candidates.length}; keeping (recorded opt-in): ${keep.length}; switching to no consent: ${flip.length}`);
  if (!apply) { console.log('dry run only; pass --apply to make the change'); return; }

  const now = new Date().toISOString();
  for (let i = 0; i < flip.length; i += 200) {
    const { error } = await supabaseAdmin
      .from('leads')
      .update({ sms_consent: false, sms_consent_at: now, sms_consent_source: 'no_recorded_opt_in' })
      .in('id', flip.slice(i, i + 200).map((l) => l.id))
      .eq('sms_consent', true);
    if (error) throw new Error(error.message);
  }
  console.log('done');
}

main().catch((e) => { console.error(e); process.exit(1); });
