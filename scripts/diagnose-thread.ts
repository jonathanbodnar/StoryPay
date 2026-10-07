/**
 * READ-ONLY. Compares a text thread as StoryVenue has it with the same
 * conversation in the venue's texting account (GHL), message by message, to
 * find texts that are missing from StoryVenue or stored under the wrong
 * sender. It changes nothing, in StoryVenue or in GHL, and prints no keys.
 *
 * One couple, by email:
 *   railway run --service "StoryVenue Backend" --environment production -- npx tsx --tsconfig ./tsconfig.json scripts/diagnose-thread.ts summerbenassi8@gmail.com
 *
 * Every venue (its most recently active text threads, 5 each by default):
 *   railway run --service "StoryVenue Backend" --environment production -- npx tsx --tsconfig ./tsconfig.json scripts/diagnose-thread.ts --all
 *
 * Message text is cut to its first 28 characters.
 *
 * A venue-side text that isn't in the thread is only called MISSING when the
 * sync would have brought it in. Left out on purpose, and counted apart: a
 * text that never reached the couple (failed / undelivered), one with no words
 * (a picture alone), and one kept under the couple's other thread. Each
 * missing one gets a line saying when it was sent and how, never its words.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { getGhlToken, listGhlConversationIdsForContactOrdered, listGhlConversationMessages } from '@/lib/ghl';
import { bodyFromGhlApiMessage, ghlApiMessageId, ghlApiMessagesFromResponse } from '@/lib/ghl-sms-conversations';
import { wasNotDelivered } from '@/lib/venue-side-texts';

const args = process.argv.slice(2);
const all = args.includes('--all');
const perVenue = Math.max(1, Math.min(20, Number(args[args.indexOf('--all') + 1]) || 5));
const email = args.find((a) => a.includes('@')) ?? '';
if (!all && !email) {
  console.error('Give a couple’s email, or --all.');
  process.exit(1);
}

type Stored = { id: string; created_at: string; sender_kind: string; channel: string; visibility: string; body: string; ghl_message_id: string | null };
type Ghl = Record<string, unknown>;

const clip = (s: unknown, n = 28) => JSON.stringify(String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n));
const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const when = (iso: unknown) => {
  const d = new Date(String(iso ?? ''));
  return Number.isNaN(d.getTime()) ? '(no time)        ' : d.toISOString().slice(0, 16).replace('T', ' ');
};
const ago = (iso: unknown) => {
  const ms = Date.now() - Date.parse(String(iso ?? ''));
  if (!Number.isFinite(ms)) return 'sent at an unknown time';
  const h = ms / 3_600_000;
  return h < 1 ? `sent ${Math.max(1, Math.round(ms / 60_000))} min ago` : h < 48 ? `sent ${Math.round(h)} h ago` : `sent ${Math.round(h / 24)} days ago`;
};
const isSms = (m: Ghl) => {
  const t = String(m.messageType ?? m.type ?? '').toUpperCase();
  return m.type === 2 || m.type === '2' || t.includes('SMS');
};

/** The same conversation as GHL has it, oldest first (texts only). */
async function ghlTexts(venue: { ghl_access_token?: string | null; ghl_location_id?: string | null }, contactId: string): Promise<Ghl[]> {
  const token = getGhlToken(venue);
  if (!token || !venue.ghl_location_id) return [];
  const convIds = await listGhlConversationIdsForContactOrdered(token, venue.ghl_location_id, contactId, 25);
  const out: Ghl[] = [];
  for (const id of convIds.slice(0, 8)) {
    const list = ghlApiMessagesFromResponse(await listGhlConversationMessages(token, venue.ghl_location_id, id));
    out.push(...list.filter(isSms));
  }
  return out.sort((a, b) => String(a.dateAdded ?? '').localeCompare(String(b.dateAdded ?? '')));
}

/** Is this GHL text in StoryVenue? By its id, or by the same words within 15 minutes. */
function findStored(m: Ghl, stored: Stored[]): { row: Stored; by: 'id' | 'text' } | null {
  const id = ghlApiMessageId(m);
  const byId = id ? stored.find((s) => s.ghl_message_id === id) : null;
  if (byId) return { row: byId, by: 'id' };
  const body = norm(bodyFromGhlApiMessage(m));
  const at = Date.parse(String(m.dateAdded ?? ''));
  const byText = body ? stored.find((s) => norm(s.body) === body && Math.abs(Date.parse(s.created_at) - at) < 15 * 60_000) : null;
  return byText ? { row: byText, by: 'text' } : null;
}

async function compare(threadId: string, venue: Record<string, unknown>, contactId: string, print: boolean) {
  const { data } = await supabaseAdmin.from('conversation_messages')
    .select('id, created_at, sender_kind, channel, visibility, body, ghl_message_id')
    .eq('thread_id', threadId).order('created_at', { ascending: true }).limit(400);
  const stored = ((data ?? []) as Stored[]).filter((s) => s.channel === 'sms');
  const texts = await ghlTexts(venue, contactId);

  const tally = {
    ghlTexts: texts.length, storedTexts: stored.length, venueSentMissing: 0, coupleSentMissing: 0, wrongSender: 0, missingBy: {} as Record<string, number>,
    // Venue-side texts the sync leaves out on purpose.
    neverDelivered: 0, noWords: 0, inOtherThread: 0,
    // What can be said about each text that isn't in StoryVenue, without its words.
    coupleMissing: [] as string[],
    venueMissing: [] as string[],
  };
  if (print) {
    console.log(`\nIn StoryVenue (${stored.length} texts):`);
    for (const s of stored) console.log(`  ${when(s.created_at)}  ${s.sender_kind.padEnd(9)}  ${s.ghl_message_id ? 'has CRM id' : 'no CRM id '}  ${clip(s.body)}`);
    console.log(`\nIn the venue's texting account (${texts.length} texts):`);
  }
  for (const m of texts) {
    const direction = String(m.direction ?? '(none)').toLowerCase();
    const hit = findStored(m, stored);
    const source = String(m.source ?? '(none)');
    const sentBy = m.userId ? 'a person' : source;
    let note = hit ? `in StoryVenue as ${hit.row.sender_kind} (matched by ${hit.by})` : 'NOT in StoryVenue';
    if (!hit) {
      if (direction === 'outbound') {
        const words = String(bodyFromGhlApiMessage(m) ?? '').trim();
        const id = ghlApiMessageId(m);
        const kept = id ? (await supabaseAdmin.from('conversation_messages').select('thread_id').eq('ghl_message_id', id).maybeSingle()).data as { thread_id?: string } | null : null;
        if (wasNotDelivered(m)) { tally.neverDelivered += 1; note = `not in StoryVenue: it never reached the couple (status=${String(m.status ?? '')}), left out on purpose`; }
        else if (!words) { tally.noWords += 1; note = 'not in StoryVenue: no words (a picture alone), left out on purpose'; }
        else if (kept?.thread_id && kept.thread_id !== threadId) { tally.inOtherThread += 1; note = `kept under the couple's other thread (${kept.thread_id.slice(0, 8)})`; }
        else {
          tally.venueSentMissing += 1;
          tally.missingBy[sentBy] = (tally.missingBy[sentBy] ?? 0) + 1;
          const sameWordsAnyTime = stored.some((s) => norm(s.body) === norm(words) || (norm(words).length >= 24 && norm(s.body).includes(norm(words))));
          tally.venueMissing.push(
            `${when(m.dateAdded)}  ${ago(m.dateAdded)}  sent by=${sentBy}  type=${String(m.messageType ?? m.type)}  status=${String(m.status ?? '')}  ` +
            `${words.length} characters  has a CRM id=${id ? 'yes' : 'no'}  same words stored at another time=${sameWordsAnyTime ? 'yes' : 'no'}  thread's texts in StoryVenue=${stored.length}`,
          );
        }
      } else {
        tally.coupleSentMissing += 1;
        const body = String(bodyFromGhlApiMessage(m) ?? '');
        const attachments = Array.isArray(m.attachments) ? m.attachments.length : 0;
        const sameWordsAnyTime = body.trim() ? stored.some((s) => norm(s.body) === norm(body)) : false;
        tally.coupleMissing.push(
          `${when(m.dateAdded)}  direction=${direction}  type=${String(m.messageType ?? m.type)}  status=${String(m.status ?? '')}  ` +
          `${body.trim() ? `${body.trim().length} characters` : 'no words'}  attachments=${attachments}  has a CRM id=${ghlApiMessageId(m) ? 'yes' : 'no'}  ` +
          `same words stored at another time=${sameWordsAnyTime ? 'yes' : 'no'}  thread's texts in StoryVenue=${stored.length}`,
        );
      }
    } else if ((direction === 'outbound') === (hit.row.sender_kind === 'contact')) {
      tally.wrongSender += 1;
      note += '  ← WRONG SENDER';
    }
    if (print) {
      console.log(`  ${when(m.dateAdded)}  ${direction.padEnd(8)}  type=${String(m.messageType ?? m.type)}  source=${source}  byUser=${m.userId ? 'yes' : 'no'}  status=${String(m.status ?? '')}  ${clip(bodyFromGhlApiMessage(m))}  → ${note}`);
    }
  }
  return tally;
}

async function one() {
  const { data: customers } = await supabaseAdmin.from('venue_customers').select('id, venue_id, first_name, ghl_contact_id').ilike('customer_email', email);
  if (!customers?.length) { console.log('No couple with that email.'); return; }
  for (const c of customers as Array<{ id: string; venue_id: string; first_name: string | null; ghl_contact_id: string | null }>) {
    const { data: venue } = await supabaseAdmin.from('venues').select('name, ghl_connected, ghl_location_id, ghl_access_token').eq('id', c.venue_id).single();
    const { data: threads } = await supabaseAdmin.from('conversation_threads').select('id').eq('venue_customer_id', c.id);
    console.log(`\n════ ${(venue as { name: string }).name} · ${c.first_name ?? 'couple'} · texting connected: ${(venue as { ghl_connected?: boolean }).ghl_connected ? 'yes' : 'no'} · linked to a CRM contact: ${c.ghl_contact_id ? 'yes' : 'no'}`);
    if (!c.ghl_contact_id) continue;
    for (const t of (threads ?? []) as Array<{ id: string }>) {
      console.log(`\nThread ${t.id.slice(0, 8)}`);
      const tally = await compare(t.id, venue as Record<string, unknown>, c.ghl_contact_id, true);
      console.log(`\nSUMMARY: texts the VENUE side sent that StoryVenue doesn't have: ${tally.venueSentMissing} (sent by: ${JSON.stringify(tally.missingBy)}) · couple's texts missing: ${tally.coupleSentMissing} · stored under the wrong sender: ${tally.wrongSender}`);
      console.log(`         left out on purpose: never reached the couple ${tally.neverDelivered} · no words ${tally.noWords} · kept under the couple's other thread ${tally.inOtherThread}`);
      for (const line of tally.venueMissing) console.log(`    venue-side text not in StoryVenue: ${line}`);
      for (const line of tally.coupleMissing) console.log(`    couple's text not in StoryVenue: ${line}`);
    }
  }
}

async function everyVenue() {
  const { data: venues } = await supabaseAdmin.from('venues')
    .select('id, name, ghl_connected, ghl_location_id, ghl_access_token').eq('ghl_connected', true).not('ghl_location_id', 'is', null).limit(500);
  const total = { venues: 0, threads: 0, venueSentMissing: 0, coupleSentMissing: 0, wrongSender: 0, neverDelivered: 0, noWords: 0, inOtherThread: 0, missingBy: {} as Record<string, number> };
  console.log(`Checking each venue's ${perVenue} most recently active text threads…\n`);
  for (const v of (venues ?? []) as Array<Record<string, unknown>>) {
    const { data: threads } = await supabaseAdmin.from('conversation_threads')
      .select('id, venue_customer_id').eq('venue_id', v.id as string).eq('external_reply_channel', 'sms')
      .order('last_message_at', { ascending: false }).limit(perVenue);
    if (!threads?.length) continue;
    const row = { threads: 0, venueSentMissing: 0, coupleSentMissing: 0, wrongSender: 0, neverDelivered: 0, failed: 0 };
    const missingLines: string[] = [];
    const venueLines: string[] = [];
    for (const t of threads as Array<{ id: string; venue_customer_id: string }>) {
      const { data: c } = await supabaseAdmin.from('venue_customers').select('ghl_contact_id').eq('id', t.venue_customer_id).maybeSingle();
      const contactId = (c as { ghl_contact_id?: string | null } | null)?.ghl_contact_id;
      if (!contactId) continue;
      try {
        const tally = await compare(t.id, v, contactId, false);
        row.threads += 1;
        row.venueSentMissing += tally.venueSentMissing;
        row.coupleSentMissing += tally.coupleSentMissing;
        row.wrongSender += tally.wrongSender;
        row.neverDelivered += tally.neverDelivered;
        total.neverDelivered += tally.neverDelivered;
        total.noWords += tally.noWords;
        total.inOtherThread += tally.inOtherThread;
        for (const [k, n] of Object.entries(tally.missingBy)) total.missingBy[k] = (total.missingBy[k] ?? 0) + n;
        for (const line of tally.coupleMissing) missingLines.push(`thread ${t.id.slice(0, 8)}  ${line}`);
        for (const line of tally.venueMissing) venueLines.push(`thread ${t.id.slice(0, 8)}  ${line}`);
      } catch {
        row.failed += 1;
      }
    }
    if (!row.threads && !row.failed) continue;
    total.venues += 1;
    total.threads += row.threads;
    total.venueSentMissing += row.venueSentMissing;
    total.coupleSentMissing += row.coupleSentMissing;
    total.wrongSender += row.wrongSender;
    console.log(`${String(v.name).slice(0, 34).padEnd(34)}  threads ${String(row.threads).padStart(2)}  venue-side texts missing ${String(row.venueSentMissing).padStart(3)}  couple's texts missing ${String(row.coupleSentMissing).padStart(3)}  wrong sender ${String(row.wrongSender).padStart(2)}${row.neverDelivered ? `  never reached the couple ${row.neverDelivered}` : ''}${row.failed ? `  (${row.failed} couldn't be read)` : ''}`);
    // Each text that isn't in StoryVenue: when, what kind, never its words.
    for (const line of venueLines) console.log(`    venue-side text not in StoryVenue: ${line}`);
    for (const line of missingLines) console.log(`    couple's text not in StoryVenue: ${line}`);
  }
  console.log(`\nTOTAL across ${total.venues} venues, ${total.threads} threads: venue-side texts missing ${total.venueSentMissing} (sent by: ${JSON.stringify(total.missingBy)}) · couple's texts missing ${total.coupleSentMissing} · stored under the wrong sender ${total.wrongSender}`);
  console.log(`Left out on purpose (not counted as missing): never reached the couple ${total.neverDelivered} · no words ${total.noWords} · kept under the couple's other thread ${total.inOtherThread}`);
}

(all ? everyVenue() : one()).then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
