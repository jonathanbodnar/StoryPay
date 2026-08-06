/**
 * Periodic inbound GHL SMS sync (cron).
 *
 * WHY THIS EXISTS: venues connected via a pasted Private Integration Token
 * (the standard self-serve SaaS connection) never receive GHL marketplace
 * webhooks, so inbound SMS replies for those locations only reach us when we
 * poll GHL's API. Before this cron, `syncInboundSmsFromGhlForThread` only ran
 * when a human opened the thread in the dashboard (or within 45s of an
 * outbound send) — so a bride's reply could sit invisible in GHL forever,
 * never reaching the venue dashboard, the admin Bride Replies inbox, or the
 * Slack notification. This cron closes that gap by polling every few minutes
 * for all GHL-connected venues with recent SMS activity, flowing every
 * recovered message through the normal inbound pipeline (dedupe by
 * ghl_message_id, thread insert, realtime broadcast, Slack bride-reply
 * notification, owner email).
 *
 * Rate-limit posture: threads are prioritized by most-recent SMS activity and
 * capped per run (default 40), and each thread scan is sequential. GHL calls
 * per thread ≈ 1 conversation search + 1-2 message list calls, so a full run
 * stays well under GHL's burst limits even for a single busy location.
 *
 * The cron also self-heals venue_customers rows that are missing
 * ghl_contact_id (the field the poller matches on) by looking the contact up
 * in the venue's GHL location by phone/email — read-only against GHL, writes
 * only to our own DB.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { getGhlToken, ghlRequest, normalizePhone, resolveLocationToken } from '@/lib/ghl';
import { syncInboundSmsFromGhlForThread } from '@/lib/ghl-sms-conversations';
import { logError } from '@/lib/error-log';

const PLACEHOLDER_EMAIL_RE = /@(ghl-sms\.storypay|ghl-import\.storyvenue)\.placeholder$/i;

interface GhlVenue {
  id: string;
  name: string;
  locationId: string;
  token: string;
}

export interface GhlInboundSyncResult {
  venuesConsidered: number;
  contactIdsBackfilled: number;
  backfillByVenue: Record<string, { venueName: string; backfilled: number; lookupFailed: number }>;
  threadsScanned: number;
  messagesImported: number;
  importedByVenue: Record<string, { venueName: string; imported: number; threads: number }>;
}

async function loadGhlVenues(): Promise<GhlVenue[]> {
  const { data } = await supabaseAdmin
    .from('venues')
    .select('id, name, ghl_access_token, ghl_location_id, ghl_connected')
    .eq('ghl_connected', true)
    .not('ghl_access_token', 'is', null)
    .not('ghl_location_id', 'is', null);

  const venues: GhlVenue[] = [];
  for (const v of data ?? []) {
    const token = getGhlToken(v as { ghl_access_token?: string | null });
    const locationId = (v as { ghl_location_id?: string | null }).ghl_location_id;
    if (!token || !locationId) continue;
    venues.push({
      id: (v as { id: string }).id,
      name: (v as { name?: string }).name || 'Unknown venue',
      locationId,
      token,
    });
  }
  return venues;
}

/** Look up an existing GHL contact by phone (preferred) or email. Read-only. */
async function lookupGhlContactId(
  venue: GhlVenue,
  phone: string | null,
  email: string | null
): Promise<string | null> {
  const attempts: Array<[string, string]> = [];
  const e164 = normalizePhone(phone);
  if (e164) attempts.push(['phone', e164]);
  if (email && !PLACEHOLDER_EMAIL_RE.test(email)) attempts.push(['email', email]);
  if (attempts.length === 0) return null;

  let token: string;
  try {
    token = await resolveLocationToken(venue.token, venue.locationId);
  } catch {
    token = venue.token;
  }

  for (const [key, value] of attempts) {
    try {
      const res = await ghlRequest(
        `/contacts/search/duplicate?locationId=${encodeURIComponent(venue.locationId)}&${key}=${encodeURIComponent(value)}`,
        token,
        { locationId: venue.locationId }
      );
      const id = (res as { contact?: { id?: string } }).contact?.id;
      if (id) return id;
    } catch (e) {
      console.warn('[ghl-inbound-cron] duplicate lookup failed', {
        venueId: venue.id,
        key,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return null;
}

/**
 * Resolve ghl_contact_id for venue_customers missing it, so the inbound
 * poller can match their replies. Returns customer ids that were backfilled.
 */
async function backfillMissingContactIds(
  venues: GhlVenue[],
  limit: number,
  result: GhlInboundSyncResult
): Promise<string[]> {
  if (limit <= 0) return [];
  const venueById = new Map(venues.map((v) => [v.id, v]));

  const { data: rows } = await supabaseAdmin
    .from('venue_customers')
    .select('id, venue_id, phone, customer_email')
    .in('venue_id', venues.map((v) => v.id))
    .is('ghl_contact_id', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  const backfilledIds: string[] = [];
  for (const row of rows ?? []) {
    const r = row as { id: string; venue_id: string; phone?: string | null; customer_email?: string | null };
    const venue = venueById.get(r.venue_id);
    if (!venue) continue;

    const bucket = (result.backfillByVenue[r.venue_id] ??= {
      venueName: venue.name,
      backfilled: 0,
      lookupFailed: 0,
    });

    const contactId = await lookupGhlContactId(venue, r.phone ?? null, r.customer_email ?? null);
    if (!contactId) {
      bucket.lookupFailed++;
      continue;
    }

    const { error } = await supabaseAdmin
      .from('venue_customers')
      .update({ ghl_contact_id: contactId })
      .eq('id', r.id)
      .is('ghl_contact_id', null);
    if (error) {
      // Most likely a unique clash: another customer row at this venue already
      // owns this GHL contact. Skip rather than corrupt the mapping.
      console.warn('[ghl-inbound-cron] backfill update failed', { customerId: r.id, error: error.message });
      bucket.lookupFailed++;
      continue;
    }
    bucket.backfilled++;
    result.contactIdsBackfilled++;
    backfilledIds.push(r.id);
  }
  return backfilledIds;
}

interface CandidateThread {
  threadId: string;
  venueId: string;
  venueCustomerId: string;
}

/** Threads with the most recent SMS activity first, capped. */
async function findActiveSmsThreads(
  venueIds: string[],
  activeDays: number,
  maxThreads: number
): Promise<CandidateThread[]> {
  const cutoff = new Date(Date.now() - activeDays * 24 * 60 * 60 * 1000).toISOString();

  const { data: msgs } = await supabaseAdmin
    .from('conversation_messages')
    .select('thread_id, created_at')
    .eq('channel', 'sms')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(3000);

  const orderedThreadIds: string[] = [];
  const seen = new Set<string>();
  for (const m of msgs ?? []) {
    const tid = (m as { thread_id?: string }).thread_id;
    if (tid && !seen.has(tid)) {
      seen.add(tid);
      orderedThreadIds.push(tid);
    }
  }

  const out: CandidateThread[] = [];
  for (let i = 0; i < orderedThreadIds.length && out.length < maxThreads; i += 100) {
    const chunk = orderedThreadIds.slice(i, i + 100);
    const { data: threads } = await supabaseAdmin
      .from('conversation_threads')
      .select('id, venue_id, venue_customer_id')
      .in('id', chunk)
      .in('venue_id', venueIds)
      .not('venue_customer_id', 'is', null);
    const byId = new Map(
      (threads ?? []).map((t) => [
        (t as { id: string }).id,
        t as { id: string; venue_id: string; venue_customer_id: string },
      ])
    );
    for (const tid of chunk) {
      if (out.length >= maxThreads) break;
      const t = byId.get(tid);
      if (t) out.push({ threadId: t.id, venueId: t.venue_id, venueCustomerId: t.venue_customer_id });
    }
  }
  return out;
}

/** Threads belonging to just-backfilled customers — always scanned, since
 *  these are exactly the contacts whose replies have been piling up unseen. */
async function threadsForCustomers(customerIds: string[]): Promise<CandidateThread[]> {
  if (customerIds.length === 0) return [];
  const { data: threads } = await supabaseAdmin
    .from('conversation_threads')
    .select('id, venue_id, venue_customer_id')
    .in('venue_customer_id', customerIds);
  return (threads ?? []).map((t) => ({
    threadId: (t as { id: string }).id,
    venueId: (t as { venue_id: string }).venue_id,
    venueCustomerId: (t as { venue_customer_id: string }).venue_customer_id,
  }));
}

export async function runGhlInboundSyncCron(opts: {
  maxThreads?: number;
  activeDays?: number;
  backfillLimit?: number;
} = {}): Promise<GhlInboundSyncResult> {
  const maxThreads = Math.max(1, Math.min(500, opts.maxThreads ?? 40));
  const activeDays = Math.max(1, Math.min(90, opts.activeDays ?? 14));
  const backfillLimit = Math.max(0, Math.min(1000, opts.backfillLimit ?? 20));

  const result: GhlInboundSyncResult = {
    venuesConsidered: 0,
    contactIdsBackfilled: 0,
    backfillByVenue: {},
    threadsScanned: 0,
    messagesImported: 0,
    importedByVenue: {},
  };

  const venues = await loadGhlVenues();
  result.venuesConsidered = venues.length;
  if (venues.length === 0) return result;
  const venueById = new Map(venues.map((v) => [v.id, v]));

  const backfilledCustomerIds = await backfillMissingContactIds(venues, backfillLimit, result);

  const recoveryThreads = await threadsForCustomers(backfilledCustomerIds);
  const activeThreads = await findActiveSmsThreads(
    venues.map((v) => v.id),
    activeDays,
    maxThreads
  );

  const queued = new Set<string>();
  const queue: CandidateThread[] = [];
  for (const t of [...recoveryThreads, ...activeThreads]) {
    if (queued.has(t.threadId)) continue;
    queued.add(t.threadId);
    queue.push(t);
  }

  for (const t of queue) {
    try {
      const { imported } = await syncInboundSmsFromGhlForThread({
        venueId: t.venueId,
        threadId: t.threadId,
        venueCustomerId: t.venueCustomerId,
      });
      result.threadsScanned++;
      if (imported > 0) {
        result.messagesImported += imported;
        const bucket = (result.importedByVenue[t.venueId] ??= {
          venueName: venueById.get(t.venueId)?.name || 'Unknown venue',
          imported: 0,
          threads: 0,
        });
        bucket.imported += imported;
        bucket.threads++;
      }
    } catch (e) {
      console.error('[ghl-inbound-cron] thread sync failed', {
        threadId: t.threadId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (result.messagesImported > 0) {
    console.log('[ghl-inbound-cron] recovered inbound messages', {
      messagesImported: result.messagesImported,
      importedByVenue: result.importedByVenue,
    });
  }

  return result;
}

/** Route-facing wrapper that records unexpected failures in the Error Log. */
export async function runGhlInboundSyncCronSafe(
  opts: Parameters<typeof runGhlInboundSyncCron>[0] = {}
): Promise<GhlInboundSyncResult> {
  try {
    return await runGhlInboundSyncCron(opts);
  } catch (e) {
    void logError({
      level: 'error',
      source: 'cron',
      category: 'ghl_inbound_sync_cron',
      message: 'GHL inbound SMS sync cron crashed — inbound replies for PIT-connected venues are not being polled.',
      error: e,
    });
    throw e;
  }
}
