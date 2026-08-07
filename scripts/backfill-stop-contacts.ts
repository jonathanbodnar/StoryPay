/**
 * One-time backfill: apply STOP keyword side-effects for 5 White Pine Manor
 * venue_customers who sent STOP via SMS but were not processed.
 *
 * Run: npx tsx scripts/backfill-stop-contacts.ts
 */

import { handleStopKeyword } from '../src/lib/ghl-inbound-sms-side-effects';
import { supabaseAdmin } from '../src/lib/supabase';

const VENUE_ID = 'f7690c59-a194-4c01-adbf-67564eb29ad6';

const TARGETS = [
  { venueCustomerId: '3a7b9440-f459-4770-9c99-d0c0b0be6860', name: 'Alyssa Killian',   email: 'alyssakillian@aol.com' },
  { venueCustomerId: '2a78d903-7953-4ada-8413-445ae95f6375', name: 'Robin Strand',      email: 'nibor1565@gmail.com' },
  { venueCustomerId: 'e1050bec-e590-4410-9144-e03678276dcf', name: 'Ernst De Waal',     email: 'ernstdw00@gmail.com' },
  { venueCustomerId: '892884ec-a586-40ed-b286-33af357dfa4f', name: 'Hayden Holcomb',    email: 'haydenholcomb82708@gmail.com' },
  { venueCustomerId: '825818f0-925f-4f75-a6aa-7fa4ce6bea9d', name: 'Katrina Washburn',  email: 'katmarie5279@gmail.com' },
];

async function verify() {
  const vcIds = TARGETS.map((t) => t.venueCustomerId);
  const emails = TARGETS.map((t) => t.email.toLowerCase());

  const { data: vcs } = await supabaseAdmin
    .from('venue_customers')
    .select('id, customer_email, sms_dnd, sms_dnd_source, conversation_dnd_inbound_sms')
    .in('id', vcIds);

  const { data: leads } = await supabaseAdmin
    .from('leads')
    .select('id, email, sms_dnd, ai_state, stage_id')
    .eq('venue_id', VENUE_ID)
    .in('email', emails);

  console.log('\n── Verification ──────────────────────────────────');
  for (const t of TARGETS) {
    const vc = (vcs ?? []).find((v) => v.id === t.venueCustomerId);
    const matchedLeads = (leads ?? []).filter(
      (l) => (l.email ?? '').toLowerCase() === t.email.toLowerCase(),
    );
    console.log(`\n${t.name} (${t.email})`);
    console.log('  venue_customer:', vc
      ? { sms_dnd: vc.sms_dnd, sms_dnd_source: vc.sms_dnd_source, conversation_dnd_inbound_sms: vc.conversation_dnd_inbound_sms }
      : 'NOT FOUND');
    console.log('  leads:', matchedLeads.length === 0 ? '(none found)' : matchedLeads.map((l) => ({
      id: l.id, sms_dnd: l.sms_dnd, ai_state: l.ai_state,
    })));
  }
}

async function main() {
  console.log('=== Backfill: White Pine Manor STOP contacts ===');
  console.log(`venue_id: ${VENUE_ID}`);
  console.log(`Processing ${TARGETS.length} contacts…\n`);

  for (const target of TARGETS) {
    process.stdout.write(`[${target.name}] running handleStopKeyword… `);
    try {
      const wasStop = await handleStopKeyword({
        venueId: VENUE_ID,
        venueCustomerId: target.venueCustomerId,
        messageBody: 'STOP',
        logPrefix: '[backfill-stop-contacts]',
      });
      console.log(wasStop ? 'OK' : 'WARN: not treated as STOP keyword');
    } catch (err) {
      console.error('ERROR:', err);
    }
  }

  await verify();
  console.log('\n=== Done ===');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
