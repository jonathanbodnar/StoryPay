/**
 * StoryVenue LeadFinder™ — from an inbound message to a lead.
 *
 * Flow: dedupe → record the arrival → guards (loop, rate, Gmail confirmation,
 * flag, auto-reply) → extract → classify → dedupe against leads → create or
 * update the lead → update the arrival row → mirror a copy to the venue.
 *
 * Rules that shape the whole thing:
 *
 *   1. The arrival row is written BEFORE any processing, so nothing is lost to a
 *      webhook retry, a timeout, or a crash. Its status is the record of what
 *      happened, and a row left `pending` by a crash is picked up again by the
 *      provider's next retry (see `reclaimStalePending`).
 *   2. Nothing is thrown away silently. A message that does not become a lead is
 *      marked `skipped` WITH a reason, so it can be inspected rather than
 *      vanishing — and the venue gets a copy of it in their own inbox.
 *   3. Nothing we send may come back and be processed again. A venue that
 *      forwards ALL its mail to LeadFinder would otherwise receive the inbox
 *      copy, forward it back, get another copy, and so on forever.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { findMatchingLeadIds } from '@/lib/find-matching-leads';
import { applySystemTags, ensureSystemTagsForVenue } from '@/lib/system-tags';
import { logNewLeadOpportunity, sendBookingSystemGuide, onMarketingFormSubmitted } from '@/lib/marketing-email-worker';
import { notifyOwnerNewLead } from '@/lib/owner-notifications';
import { dispatchIntegrationEvent } from '@/lib/integration-events';
import { maybePushLeadToTripleseat } from '@/lib/tripleseat';
import { ensureListingForm } from '@/lib/listing-lead-form';
import { syncLeadAnswersToContact } from '@/lib/leadfinder/contact-sync';
import { startGuideInvite } from '@/lib/guide-invite';
import { findLeadFinderTestRef, leadFinderEnabledForSlug } from '@/lib/leadfinder/address';
import {
  classifyInbound,
  domainOf,
  extractLeadFromEmail,
  isVenueOwnPhone,
  parseAddressHeader,
  plausibleCoupleName,
  type ExtractedLead,
  type VenueIdentity,
} from '@/lib/leadfinder/extract';
import {
  extractWithAi,
  needsAiFallback,
  scoreExtractedFields,
  type AiExtractedFields,
} from '@/lib/leadfinder/ai-extract';
import { parseGmailForwardingConfirmation } from '@/lib/leadfinder/gmail-confirmation';
import { venueTimeZoneFromLocation } from '@/lib/venue-zip-timezone';
import {
  LEADFINDER_MIRROR_FOOTER_MARKER,
  LEADFINDER_MIRROR_HEADER,
  mirrorArrivalToVenue,
  type MirrorOutcome,
} from '@/lib/leadfinder/mirror';

export interface LeadFinderIngestInput {
  venueId: string;
  fromRaw: string;
  replyTo: string | null;
  subject: string | null;
  /** The body to read, already line-structured (see chooseLeadFinderBody). */
  text: string;
  inReplyTo: string | null;
  references: string | null;
  messageId: string | null;
  /** Fallback dedupe key when the sender gave no Message-ID. */
  dedupeFallbackId: string | null;
  /** Display name from the From header, when the sender provided one. */
  senderName?: string | null;
  receivedAt: Date;
  /** Raw headers from the receiving provider — loop and auto-reply detection. */
  headers?: Record<string, unknown>;
}

export interface LeadFinderIngestResult {
  /**
   * `in_progress`: the same message is already being processed (or a crashed
   * attempt is not yet old enough to take over). The webhook answers with a
   * retryable status so the provider comes back later instead of dropping it.
   */
  outcome: 'created' | 'updated' | 'skipped' | 'duplicate' | 'in_progress' | 'failed';
  leadId?: string | null;
  reason?: string | null;
  detectedSource?: string | null;
  confidence?: number;
}

const PARSER_VERSION = 'deterministic-v2';

/**
 * The line between "send the guide now" and "ask a human first".
 *
 * At or above this, the extracted fields are complete enough to trust the way
 * we always have. Below it we still create the lead and still alert the owner —
 * a venue must never miss an arrival — but we hold the couple-facing follow-up
 * until a person confirms the record is right.
 */
const CONFIDENCE_THRESHOLD = 0.75;

/**
 * More arrivals than this for one venue in an hour is not inquiry traffic — it
 * is a whole inbox being forwarded, or a loop we failed to recognise. Stop
 * processing (and stop sending copies) until the rate drops.
 */
const HOURLY_ARRIVAL_CAP = 60;

/** A `pending` row older than this was abandoned by a crashed attempt. */
const STALE_PENDING_MS = 3 * 60 * 1000;
/** How many times a crashed arrival is retried before it is left for a human. */
const MAX_PROCESSING_ATTEMPTS = 3;

interface VenueCore {
  id: string;
  slug: string | null;
  name: string | null;
  notification_email: string | null;
  email: string | null;
  leadfinder_mirror_enabled: boolean | null;
}

interface Arrival {
  fromRaw: string;
  senderEmail: string | null;
  senderName: string | null;
  replyTo: string | null;
  subject: string | null;
  text: string;
  receivedAt: Date;
}

/** Turn "sarah.johnson@example.com" into "Sarah Johnson" as a display fallback. */
function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  const words = local.split(/[._\-+]+/).filter((w) => w && !/^\d+$/.test(w));
  if (words.length === 0) return email;
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** An empty string and NULL both mean "not set" in these columns. */
function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

/** Case-insensitive header read; Resend hands headers over keyed as sent. */
function headerValue(headers: Record<string, unknown> | undefined, name: string): string | null {
  if (!headers) return null;
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() !== want) continue;
    if (typeof v === 'string') return v;
    if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  }
  return null;
}

// ── Guards ───────────────────────────────────────────────────────────────────

/** Addresses our own platform sends from. Mail from these is never an inquiry. */
function ownSenderAddresses(): Set<string> {
  const out = new Set<string>(['notifications@send.storyvenue.com']);
  for (const raw of [process.env.NOTIFICATION_FROM_EMAIL, process.env.RESEND_DEFAULT_FROM]) {
    const addr = parseAddressHeader(raw ?? '').email;
    if (addr) out.add(addr);
  }
  return out;
}

/** Domains that are ours: never a couple, and never a legitimate source of leads. */
function ownDomains(): string[] {
  const out = new Set<string>(['send.storyvenue.com']);
  const inbound = process.env.CONVERSATIONS_INBOUND_DOMAIN?.trim().toLowerCase();
  if (inbound) out.add(inbound);
  for (const addr of ownSenderAddresses()) {
    const d = domainOf(addr);
    if (d) out.add(d);
  }
  for (const d of (process.env.RESEND_VERIFIED_DOMAINS ?? '').split(',')) {
    if (d.trim()) out.add(d.trim().toLowerCase());
  }
  return [...out];
}

/**
 * Is this one of our INBOX COPIES coming back? Checked two independent ways,
 * because each can be lost in a forward: our marker header (kept by Gmail
 * forwarding) and the footer sentence every copy carries (kept by anything that
 * forwards the body). Checked before everything else — including the test
 * path, because a copy of a test quotes the test's token.
 */
function isMirrorCopy(arrival: Arrival, headers?: Record<string, unknown>): boolean {
  if (headerValue(headers, LEADFINDER_MIRROR_HEADER)) return true;
  return arrival.text.includes(LEADFINDER_MIRROR_FOOTER_MARKER);
}

/**
 * Anything else sent by our own platform (a new-lead alert, a guide) that a
 * forward-everything rule bounced back. Never an inquiry.
 */
function isFromOurPlatform(arrival: Arrival): boolean {
  const sender = arrival.senderEmail?.toLowerCase() ?? null;
  if (!sender) return false;
  if (ownSenderAddresses().has(sender)) return true;
  const inbound = process.env.CONVERSATIONS_INBOUND_DOMAIN?.trim().toLowerCase();
  return !!inbound && domainOf(sender) === inbound;
}

/** A vacation responder or other automatic REPLY (not a notification). */
function isAutoReply(headers?: Record<string, unknown>): boolean {
  const autoSubmitted = headerValue(headers, 'auto-submitted')?.toLowerCase() ?? '';
  if (autoSubmitted.startsWith('auto-replied')) return true;
  if (headerValue(headers, 'x-autoreply') || headerValue(headers, 'x-autorespond')) return true;
  return (headerValue(headers, 'precedence') ?? '').toLowerCase() === 'auto_reply';
}

async function arrivalsInLastHour(venueId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('leadfinder_imports')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', venueId)
    .gte('received_at', new Date(Date.now() - 60 * 60 * 1000).toISOString());
  if (error) return 0; // never block ingestion on a failed count
  return count ?? 0;
}

// ── Venue ────────────────────────────────────────────────────────────────────

async function loadVenueCore(venueId: string): Promise<VenueCore | null> {
  const { data } = await supabaseAdmin
    .from('venues')
    .select('id, slug, name, notification_email, email, leadfinder_mirror_enabled')
    .eq('id', venueId)
    .maybeSingle();
  return (data as VenueCore | null) ?? null;
}

/**
 * Everything that identifies the VENUE — its name, every address it or its team
 * sends from, its phone numbers and its own domains — so none of it is ever
 * read back as the couple's details. Also its local time zone (from its ZIP),
 * so what we email the venue reads in the venue's own time. Best-effort: a
 * failed read just means a shorter list and no zone, never a failed ingest.
 */
async function loadVenueProfile(venue: VenueCore): Promise<{
  identity: VenueIdentity;
  timeZone: string | null;
  /** For the inbox copy's branded shell, same as other owner emails. */
  brandColor: string | null;
  logoUrl: string | null;
}> {
  const emails: Array<string | null> = [venue.email, venue.notification_email];
  const phones: Array<string | null> = [];
  const domains: string[] = ownDomains();
  let timeZone: string | null = null;
  let brandColor: string | null = null;
  let logoUrl: string | null = null;

  try {
    const { data } = await supabaseAdmin.from('venues').select('*').eq('id', venue.id).maybeSingle();
    const row = (data ?? {}) as Record<string, unknown>;
    const str = (k: string) => (typeof row[k] === 'string' ? (row[k] as string) : null);
    brandColor = str('brand_color');
    logoUrl = str('brand_logo_url') || str('logo_url');
    timeZone = venueTimeZoneFromLocation({
      zip: str('zip'),
      brand_zip: str('brand_zip'),
      timezone: str('timezone'),
      state: str('state'),
      location_state: str('location_state'),
      brand_state: str('brand_state'),
    });
    emails.push(str('brand_email'), str('owner_email'), str('contact_email'));
    phones.push(str('phone'), str('notification_phone'), str('brand_phone'), str('owner_phone'));
    for (const site of [str('website'), str('brand_website')]) {
      if (!site) continue;
      try {
        const host = new URL(site.startsWith('http') ? site : `https://${site}`).hostname.replace(/^www\./, '');
        if (host.includes('.')) domains.push(host);
      } catch {
        /* not a URL — ignore */
      }
    }
  } catch (e) {
    console.warn('[leadfinder] venue identity read failed (non-fatal):', e);
  }

  try {
    const { data } = await supabaseAdmin
      .from('venue_team_members')
      .select('email')
      .eq('venue_id', venue.id)
      .limit(200);
    for (const r of (data ?? []) as Array<{ email: string | null }>) emails.push(r.email);
  } catch {
    /* team list is a nice-to-have */
  }

  return { identity: { name: venue.name, emails, phones, domains }, timeZone, brandColor, logoUrl };
}

// ── Enrichment helpers ───────────────────────────────────────────────────────

/**
 * Fill ONLY the gaps the deterministic pass left. Deterministic precedence is
 * absolute: a field the parser read is never overwritten by the model, so a
 * later AI guess can never degrade something we already know. Returns true when
 * the AI contributed at least one field — which is what `extraction_source`
 * records.
 */
function applyAiGapFill(target: ExtractedLead, aiRaw: AiExtractedFields, venue: VenueIdentity): boolean {
  // The model is held to the same rules as the parser: a brand, a role or the
  // venue's own name is not the couple, and the venue's own number is not theirs.
  const aiName = plausibleCoupleName(aiRaw.name, venue);
  const ai: AiExtractedFields = {
    ...aiRaw,
    name: aiName,
    firstName: aiName ? aiRaw.firstName : null,
    lastName: aiName ? aiRaw.lastName : null,
    phone: isVenueOwnPhone(aiRaw.phone, venue) ? null : aiRaw.phone,
  };
  let contributed = false;
  const take = (current: string | null, candidate: string | null): string | null => {
    if (isBlank(current) && !isBlank(candidate)) {
      contributed = true;
      return candidate;
    }
    return current;
  };

  target.name = take(target.name, ai.name);
  target.firstName = take(target.firstName, ai.firstName);
  target.lastName = take(target.lastName, ai.lastName);
  target.phone = take(target.phone, ai.phone);
  target.weddingDate = take(target.weddingDate, ai.weddingDate);
  target.venueMatters = take(target.venueMatters, ai.venueMatters);
  target.timeline = take(target.timeline, ai.timeline);
  target.message = take(target.message, ai.message);
  if (target.guestCount === null && ai.guestCount !== null) {
    target.guestCount = ai.guestCount;
    contributed = true;
  }

  if (contributed) {
    target.found = (['name', 'email', 'phone', 'weddingDate', 'guestCount', 'venueMatters', 'timeline', 'message'] as const)
      .filter((k) => target[k] !== null && target[k] !== undefined);
  }
  return contributed;
}

/**
 * How far the chosen email address can be trusted. A labelled field, the
 * sender of the original message or a Reply-To is the couple's own; an address
 * spotted in free text is probably theirs; a marketplace relay is a way to
 * reach them, not their address.
 */
function emailConfidence(e: ExtractedLead): number {
  if (!e.email) return 0;
  if (e.emailIsRelay) return 0.5;
  if (e.emailSource === 'body') return 0.7;
  return 1;
}


/**
 * The new-lead fan-out that every other entry point fires (public web form,
 * StoryVenue directory, manual entry). Kept in one function so the LeadFinder
 * entry point can never quietly drift from the others.
 *
 * Covers:
 *   1. Owner + team email/SMS/push, per-recipient toggles   (notifyOwnerNewLead)
 *   2. The in-app badge on the Lead Inbox (sidebar + tab bar) (broadcastNewLead)
 *   3. External integrations subscribed to `lead.created`    (dispatchIntegrationEvent)
 *   4. The connected CRM connectors (Tripleseat, Event Temple)
 *
 * NOTE ON THE ONE DELIBERATE DIFFERENCE: LeadFinder leads are never auto-texted
 * because a phone number read out of a forwarded email is not TCPA consent. That
 * restriction is about outbound SMS to the COUPLE. It does not affect anything in
 * here — the venue owner is notified on every channel they have enabled, exactly
 * as they are for a form or directory inquiry.
 */
function notifyNewLeadLikeEveryOtherEntryPoint(input: {
  venueId: string;
  leadId: string;
  fullName: string;
  email: string;
  phone: string | null;
  createdAt: string;
  /** Human label for the owner alert, e.g. "The Knot via LeadFinder™". */
  sourceLabel: string;
  crmLead: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    wedding_date?: string | null;
    guest_count?: number | null;
    message?: string | null;
    booking_timeline?: string | null;
    venue_matters?: string | null;
  };
}): void {
  const { venueId, leadId, fullName, email, phone, createdAt, crmLead } = input;

  notifyOwnerNewLead({
    venueId,
    leadId,
    fullName,
    email,
    phone,
    source: input.sourceLabel,
    createdAt,
  });

  void import('@/lib/realtime/broadcast')
    .then(({ broadcastNewLead }) =>
      broadcastNewLead({ venueId, leadId, source: 'leadfinder', createdAt }),
    )
    .catch(() => {});

  void dispatchIntegrationEvent(venueId, 'lead.created', {
    lead: {
      id: leadId,
      first_name: crmLead.first_name || '',
      last_name: crmLead.last_name || '',
      full_name: fullName,
      email,
      phone: phone || '',
      source: 'leadfinder',
      created_at: createdAt,
    },
  });

  void maybePushLeadToTripleseat(venueId, crmLead).catch(() => {});

  void import('@/lib/eventtemple')
    .then(({ maybePushLeadToEventTemple }) => maybePushLeadToEventTemple(venueId, crmLead))
    .catch(() => {});
}

// ── Crash recovery ───────────────────────────────────────────────────────────

type ReclaimResult = 'claimed' | 'busy' | 'unavailable';

/**
 * A duplicate delivery of an arrival that is still `pending`. Either another
 * request is working on it right now (`busy` → tell the provider to retry
 * later), or the attempt that recorded it died mid-way — a deploy restart, a
 * timeout — and it is old enough to take over (`claimed`).
 *
 * The claim is optimistic: it only succeeds while `processing_attempts` still
 * holds the value we read, so two concurrent retries can never both proceed.
 * `unavailable` means the columns from migration 258 are not there yet (or the
 * row has used up its attempts); the caller then behaves exactly as before.
 */
async function reclaimStalePending(importId: string): Promise<ReclaimResult> {
  const { data, error } = await supabaseAdmin
    .from('leadfinder_imports')
    .select('processing_status, processing_attempts, processing_started_at, created_at')
    .eq('id', importId)
    .maybeSingle();
  if (error || !data) return 'unavailable';

  const row = data as {
    processing_status: string;
    processing_attempts: number | null;
    processing_started_at: string | null;
    created_at: string;
  };
  if (row.processing_status !== 'pending') return 'unavailable';
  const attempts = row.processing_attempts ?? 0;
  if (attempts >= MAX_PROCESSING_ATTEMPTS) return 'unavailable';

  const startedAt = new Date(row.processing_started_at ?? row.created_at).getTime();
  if (Date.now() - startedAt < STALE_PENDING_MS) return 'busy';

  const { data: claimed, error: claimErr } = await supabaseAdmin
    .from('leadfinder_imports')
    .update({ processing_attempts: attempts + 1, processing_started_at: new Date().toISOString() })
    .eq('id', importId)
    .eq('processing_status', 'pending')
    .eq('processing_attempts', attempts)
    .select('id')
    .maybeSingle();
  if (claimErr) return 'unavailable';
  return claimed ? 'claimed' : 'busy';
}

/** Rebuild an arrival from its stored row, so a crashed one can be processed again. */
async function loadStoredArrival(importId: string): Promise<Arrival | null> {
  const { data } = await supabaseAdmin
    .from('leadfinder_imports')
    .select('sender, reply_to, subject, raw_text, received_at, created_at')
    .eq('id', importId)
    .maybeSingle();
  if (!data) return null;
  const row = data as {
    sender: string | null;
    reply_to: string | null;
    subject: string | null;
    raw_text: string | null;
    received_at: string | null;
    created_at: string;
  };
  const from = parseAddressHeader(row.sender ?? '');
  return {
    fromRaw: row.sender ?? '',
    senderEmail: from.email,
    senderName: from.name,
    replyTo: row.reply_to,
    subject: row.subject,
    text: row.raw_text ?? '',
    receivedAt: new Date(row.received_at ?? row.created_at),
  };
}

// ── Entry point ──────────────────────────────────────────────────────────────

export async function ingestLeadFinderEmail(
  input: LeadFinderIngestInput,
): Promise<LeadFinderIngestResult> {
  const { venueId } = input;

  // ── 1. Resolve the venue ─────────────────────────────────────────────────
  const venue = await loadVenueCore(venueId);
  if (!venue) return { outcome: 'skipped', reason: 'venue_not_found' };

  // ── 2. Idempotency (and recovery of a crashed attempt) ───────────────────
  const messageId = input.messageId?.replace(/^<|>$/g, '').trim() || input.dedupeFallbackId;
  if (messageId) {
    const { data: seen } = await supabaseAdmin
      .from('leadfinder_imports')
      .select('id, lead_id, processing_status')
      .eq('venue_id', venueId)
      .eq('original_message_id', messageId)
      .maybeSingle();
    if (seen) {
      const row = seen as { id: string; lead_id: string | null; processing_status: string };
      if (row.processing_status === 'pending') {
        const reclaim = await reclaimStalePending(row.id);
        if (reclaim === 'busy') return { outcome: 'in_progress', reason: 'already_processing' };
        if (reclaim === 'claimed') {
          const stored = await loadStoredArrival(row.id);
          if (stored) {
            console.warn('[leadfinder] resuming an arrival a previous attempt left pending', { venueId, importId: row.id });
            return processArrival({ venue, importId: row.id, arrival: stored });
          }
        }
      }
      return { outcome: 'duplicate', leadId: row.lead_id, reason: 'already_imported' };
    }
  }

  const from = parseAddressHeader(input.fromRaw);
  const arrival: Arrival = {
    fromRaw: input.fromRaw,
    senderEmail: from.email,
    senderName: input.senderName ?? from.name,
    replyTo: input.replyTo,
    subject: input.subject,
    text: input.text.slice(0, 200_000),
    receivedAt: input.receivedAt,
  };

  // Counted BEFORE this arrival is stored.
  const overLimit = (await arrivalsInLastHour(venueId)) >= HOURLY_ARRIVAL_CAP;

  // ── 3. Record the arrival before doing anything with it ──────────────────
  const { data: insertedImport, error: insertErr } = await supabaseAdmin
    .from('leadfinder_imports')
    .insert({
      venue_id: venueId,
      sender: input.fromRaw,
      sender_domain: domainOf(input.fromRaw),
      reply_to: input.replyTo,
      original_message_id: messageId,
      in_reply_to: input.inReplyTo,
      email_references: input.references,
      subject: input.subject,
      received_at: input.receivedAt.toISOString(),
      raw_text: arrival.text,
      processing_status: 'pending',
    })
    .select('id')
    .maybeSingle();

  // A unique-violation here means a concurrent delivery won the race — that
  // request is processing it now.
  if (insertErr && /duplicate key|unique/i.test(insertErr.message)) {
    return { outcome: 'in_progress', reason: 'already_processing' };
  }
  if (insertErr || !insertedImport) {
    console.error('[leadfinder] could not record import:', insertErr?.message);
    return { outcome: 'failed', reason: 'import_row_failed' };
  }

  return processArrival({
    venue,
    importId: (insertedImport as { id: string }).id,
    arrival,
    headers: input.headers,
    overLimit,
  });
}

// ── Processing ───────────────────────────────────────────────────────────────

async function processArrival(p: {
  venue: VenueCore;
  importId: string;
  arrival: Arrival;
  headers?: Record<string, unknown>;
  overLimit?: boolean;
}): Promise<LeadFinderIngestResult> {
  const { venue, importId, arrival } = p;
  const venueId = venue.id;
  const senderDomain = domainOf(arrival.fromRaw);
  // Identity (so the venue is never read as the couple) and local time zone
  // (so the inbox copy reads in the venue's own time).
  const { identity, timeZone, brandColor, logoUrl } = await loadVenueProfile(venue);

  // Everything the mirror needs, captured once. The mirror is built from the
  // SAME stored arrival so its copy is faithful, and it is fired on terminal
  // outcomes — created, updated, skipped and failed — because the point is that
  // the owner can see what LeadFinder did or did not take. Idempotency lives in
  // the mirror itself (an atomic claim on `mirrored_at`).
  const mirror = (outcome: MirrorOutcome): Promise<void> =>
    mirrorArrivalToVenue(
      {
        venueId,
        importId,
        recipient: venue.notification_email || venue.email || null,
        // Tolerant reader: a deploy without the column (null) keeps mirroring ON,
        // matching the database DEFAULT.
        enabled: venue.leadfinder_mirror_enabled !== false,
        subject: arrival.subject,
        sender: arrival.fromRaw,
        originalReplyTo: arrival.replyTo,
        receivedAt: arrival.receivedAt,
        timeZone,
        venueName: venue.name,
        brandColor,
        logoUrl,
        rawText: arrival.text,
      },
      outcome,
    );

  const finish = async (
    status: 'skipped' | 'failed',
    reason: string,
    opts: { mirror: boolean; detail?: string; detectedSource?: string | null },
  ): Promise<LeadFinderIngestResult> => {
    const patch: Record<string, unknown> = { processing_status: status, failure_reason: opts.detail ?? reason };
    if (opts.detectedSource) patch.detected_source = opts.detectedSource;
    await supabaseAdmin.from('leadfinder_imports').update(patch).eq('id', importId);
    if (opts.mirror) await mirror({ kind: status, reason });
    return { outcome: status, reason, detectedSource: opts.detectedSource ?? null };
  };
  const fail = (reason: string, detail?: string) => finish('failed', reason, { mirror: true, detail });
  const skip = (reason: string, opts?: { mirror?: boolean; detectedSource?: string | null }) =>
    finish('skipped', reason, { mirror: opts?.mirror ?? true, detectedSource: opts?.detectedSource });

  // ── 4. Guards that must run before anything else ─────────────────────────
  // Our own inbox copy coming back is recorded but NEVER mirrored: mirroring it
  // is exactly the step that would keep a forwarding loop spinning.
  if (isMirrorCopy(arrival, p.headers)) return skip('own_message_loop', { mirror: false });

  // A test the venue sent from the LeadFinder card (it comes from our own
  // address, so it must be recognised before the platform-mail guard below).
  // A dry run: read and reported back, never a lead, nothing sent to a couple.
  const testRef = findLeadFinderTestRef(arrival.text, venueId);
  if (testRef) {
    const read = extractLeadFromEmail({
      subject: arrival.subject,
      text: arrival.text,
      senderName: arrival.senderName,
      senderEmail: arrival.senderEmail,
      replyTo: arrival.replyTo,
      venue: identity,
    });
    const testVerdict = classifyInbound({ subject: arrival.subject, senderDomain, senderEmail: arrival.senderEmail, extracted: read });
    const scored = scoreExtractedFields(read, { emailConfidence: emailConfidence(read) });
    await supabaseAdmin
      .from('leadfinder_imports')
      .update({
        processing_status: 'skipped',
        failure_reason: 'test_inquiry',
        parser_version: PARSER_VERSION,
        extraction_source: 'deterministic',
        extraction_confidence: scored.overallConfidence,
        classification_confidence: testVerdict.confidence,
        field_confidence: scored.fieldConfidence,
      })
      .eq('id', importId);
    await mirror({
      kind: 'test',
      wouldCreateLead: testVerdict.accept,
      reason: testVerdict.reason,
      read: {
        name: read.name,
        email: read.email,
        phone: read.phone,
        weddingDate: read.weddingDate,
        guestCount: read.guestCount,
      },
    });
    return { outcome: 'skipped', reason: 'test_inquiry' };
  }

  // Anything else our platform sent (a new-lead alert, a guide) bounced back by
  // a forward-everything rule: recorded, never mirrored, never a lead.
  if (isFromOurPlatform(arrival)) return skip('own_message_loop', { mirror: false });
  if (p.overLimit) return skip('rate_limited', { mirror: false });

  // Gmail's forwarding confirmation: not an inquiry, but the venue needs the
  // code in it to finish connecting. Surfaced whether or not LeadFinder is on,
  // because setting up forwarding is the first step either way.
  const gmail = parseGmailForwardingConfirmation({
    senderEmail: arrival.senderEmail,
    subject: arrival.subject,
    text: arrival.text,
  });
  if (gmail) {
    await supabaseAdmin
      .from('leadfinder_imports')
      .update({ processing_status: 'skipped', failure_reason: 'gmail_forwarding_confirmation' })
      .eq('id', importId);
    await mirror({ kind: 'gmail_confirmation', ...gmail });
    return { outcome: 'skipped', reason: 'gmail_forwarding_confirmation' };
  }

  // Checked AFTER recording the arrival, deliberately: a message sent while the
  // feature is off still leaves a trace (and the venue still gets its copy), so
  // "I sent one and nothing happened" is always diagnosable.
  if (!leadFinderEnabledForSlug(venue.slug)) return skip('leadfinder_disabled_for_venue');

  if (isAutoReply(p.headers)) return skip('auto_reply');

  // ── 5. Extract and classify ──────────────────────────────────────────────
  let extracted: ExtractedLead;
  let verdict;
  try {
    extracted = extractLeadFromEmail({
      subject: arrival.subject,
      text: arrival.text,
      senderName: arrival.senderName,
      senderEmail: arrival.senderEmail,
      replyTo: arrival.replyTo,
      venue: identity,
    });
    verdict = classifyInbound({ subject: arrival.subject, senderDomain, senderEmail: arrival.senderEmail, extracted });
  } catch (e) {
    console.error('[leadfinder] extract threw:', e);
    return fail('extract_threw');
  }

  const detectedSource = verdict.detectedSource;
  if (!verdict.accept) return skip(verdict.reason ?? 'rejected', { detectedSource });

  const email = extracted.email as string;   // classifier guarantees non-null

  // ── 5b. AI fallback — for a result too thin to act on by itself ─────────
  // Runs when the deterministic read is thin OR would otherwise go to review:
  // a name and an email with the date and guest count written in a sentence is
  // exactly what the model can finish. It only ever fills gaps (see
  // applyAiGapFill), so it cannot degrade anything the parser read.
  let aiContributed = false;
  const beforeAi = scoreExtractedFields(extracted, { emailConfidence: emailConfidence(extracted) }).overallConfidence;
  if (needsAiFallback(extracted) || beforeAi < CONFIDENCE_THRESHOLD) {
    const ai = await extractWithAi({
      subject: extracted.forwarded?.subject ?? arrival.subject,
      text: extracted.inquiryText || arrival.text,
      senderEmail: email,
      senderDisplayName: extracted.name,
    });
    if (ai) aiContributed = applyAiGapFill(extracted, ai.fields, identity);
  }

  const { overallConfidence: extractionConfidence, fieldConfidence } = scoreExtractedFields(extracted, {
    emailConfidence: emailConfidence(extracted),
  });
  const extractionSource = aiContributed ? 'ai' : 'deterministic';

  // ── 5c. Confidence routing ───────────────────────────────────────────────
  //   ≥ 0.75 → create/update the lead, fire the full owner fan-out, send the guide.
  //   <  0.75 → STILL create the lead and STILL alert the owner, but hold every
  //             couple-facing step until a human confirms the record.
  // A marketplace RELAY address is always held: replies to it route through the
  // marketplace's own inbox, so a person should decide whether the automated
  // guide belongs there.
  const needsReview = extracted.emailIsRelay || extractionConfidence < CONFIDENCE_THRESHOLD;
  const reviewReason = !needsReview
    ? null
    : extracted.emailIsRelay
      ? 'relay_address'
      : aiContributed ? 'ai_fallback_uncertain' : 'low_confidence';

  // ── 6. Dedupe against existing leads ─────────────────────────────────────
  // By email, and by phone ONLY when the phone came from a labelled field: a
  // number spotted in free text is not certain enough to merge two people.
  const matches = await findMatchingLeadIds({
    venueId,
    email,
    phone: extracted.phoneLabelled ? extracted.phone : null,
  });

  const fields = {
    first_name: extracted.firstName,
    last_name: extracted.lastName,
    guest_count: extracted.guestCount,
    wedding_date: extracted.weddingDate,
    venue_matters: extracted.venueMatters,
    booking_timeline: extracted.timeline,
    message: extracted.message,
    phone: extracted.phone,
  };

  if (matches.size > 0) {
    // Update rather than insert, and only fill blanks — a field the venue has
    // already corrected by hand must not be overwritten by a later email.
    const existingId = [...matches][0];
    const { data: existing } = await supabaseAdmin
      .from('leads')
      .select('id, name, first_name, last_name, guest_count, wedding_date, venue_matters, booking_timeline, message, phone')
      .eq('id', existingId)
      .maybeSingle();

    if (existing) {
      const e = existing as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(fields)) {
        if (!isBlank(v) && isBlank(e[k])) patch[k] = v;
      }
      if (Object.keys(patch).length > 0) {
        patch.updated_at = new Date().toISOString();
        await supabaseAdmin.from('leads').update(patch).eq('id', existingId);
      }
      // An arrival that matched an existing lead is an update to a record a
      // human is already working, and it fires no couple-facing follow-up — so
      // it is never queued for review. We still record how well it extracted.
      await supabaseAdmin
        .from('leadfinder_imports')
        .update({
          processing_status: 'processed',
          lead_id: existingId,
          detected_source: detectedSource,
          parser_version: PARSER_VERSION,
          extraction_source: extractionSource,
          extraction_confidence: extractionConfidence,
          classification_confidence: verdict.confidence,
          field_confidence: fieldConfidence,
        })
        .eq('id', importId);

      // A returning contact's profile should pick up anything new too.
      await syncLeadAnswersToContact(venueId, email, extracted);

      const existingName =
        ((existing as { name?: string | null }).name ?? '').trim() || extracted.name || email;
      await mirror({ kind: 'lead', created: false, leadId: existingId, leadName: existingName, needsReview: false });

      return { outcome: 'updated', leadId: existingId, detectedSource, confidence: verdict.confidence };
    }
  }

  // ── 7. Create the lead ───────────────────────────────────────────────────
  // `name` is NOT NULL with no default. A relay address says nothing about the
  // person, so it is never turned into a name.
  const displayName =
    extracted.name ||
    (extracted.emailIsRelay ? `${detectedSource ?? 'Email'} inquiry` : nameFromEmail(email));

  const { data: created, error: createErr } = await supabaseAdmin
    .from('leads')
    .insert({
      venue_id: venueId,
      name: displayName,
      first_name: extracted.firstName,
      last_name: extracted.lastName,
      email,
      phone: extracted.phone,           // nullable since migration 253
      guest_count: extracted.guestCount,
      wedding_date: extracted.weddingDate,
      venue_matters: extracted.venueMatters,
      booking_timeline: extracted.timeline,
      message: extracted.message,
      // Deliberately NOT 'directory' — that value already means the StoryVenue
      // listing, and these leads never touched it.
      source: 'leadfinder',
      // Which marketplace it came through ("The Knot"), shown wherever the lead
      // says where it came from. Only set at creation: attribution is first-touch.
      referral_source: detectedSource,
      status: 'new',
      // The couple gave this number to a directory, not to us, so it is not
      // consent for an automated text. Every automated SMS path checks this
      // before sending; a text from them, START or a form submission flips it.
      sms_consent:        false,
      sms_consent_at:     new Date().toISOString(),
      sms_consent_source: 'leadfinder_forwarded_email',
      updated_at: new Date().toISOString(),
    })
    .select('id, created_at')
    .maybeSingle();

  if (createErr || !created) {
    console.error('[leadfinder] lead insert failed:', createErr?.message);
    return fail('lead_insert_failed', createErr?.message ? `lead_insert_failed: ${createErr.message}` : undefined);
  }
  const leadId = (created as { id: string }).id;
  const createdAt = (created as { created_at?: string }).created_at ?? arrival.receivedAt.toISOString();

  // Notify the venue owner exactly like every other entry point does. Fired
  // right after the row exists so the push/SMS lands as fast as it does for a
  // form or directory inquiry.
  notifyNewLeadLikeEveryOtherEntryPoint({
    venueId,
    leadId,
    fullName: displayName,
    email,
    phone: extracted.phone,
    createdAt,
    sourceLabel: detectedSource ? `${detectedSource} (via LeadFinder™)` : 'LeadFinder™',
    crmLead: {
      first_name: extracted.firstName,
      last_name: extracted.lastName,
      email,
      phone: extracted.phone,
      wedding_date: extracted.weddingDate,
      guest_count: extracted.guestCount,
      message: extracted.message,
      booking_timeline: extracted.timeline,
      venue_matters: extracted.venueMatters,
    },
  });

  // Put the answers where the profile UI reads them.
  await syncLeadAnswersToContact(venueId, email, extracted);

  await supabaseAdmin
    .from('leadfinder_imports')
    .update({
      processing_status: 'processed',
      lead_id: leadId,
      detected_source: detectedSource,
      parser_version: PARSER_VERSION,
      extraction_source: extractionSource,
      extraction_confidence: extractionConfidence,
      classification_confidence: verdict.confidence,
      field_confidence: fieldConfidence,
      // The review queue is what makes a low-confidence arrival safe: the lead
      // and the owner alert exist, but a human decides before the couple is
      // contacted. `none` keeps every high-confidence arrival untouched.
      review_state: needsReview ? 'needs_review' : 'none',
      review_reason: reviewReason,
    })
    .eq('id', importId);

  // ── 8. Follow-up ─────────────────────────────────────────────────────────
  // Mirrors what any other new lead gets, with ONE deliberate difference: the
  // guide goes out by EMAIL ONLY, because a phone number read out of a forwarded
  // directory email is not consent for an automated text.
  void ensureSystemTagsForVenue(venueId)
    .then(() => applySystemTags(venueId, leadId, ['new_lead', 'inquiry_received', 'email_lead']))
    .catch((e) => console.error('[leadfinder] system tags failed:', e));

  // The "New Lead Opportunity!" marker, so the lead's thread opens with what
  // they submitted (same as a form or directory lead).
  await logNewLeadOpportunity(venueId, leadId, arrival.receivedAt.toISOString());

  // EVERYTHING BELOW THIS LINE CONTACTS THE COUPLE. Held for review when the
  // extraction was not confident enough (or the address is a relay).
  if (needsReview) {
    console.warn('[leadfinder] holding couple follow-up pending review', {
      venueId,
      importId,
      leadId,
      confidence: extractionConfidence,
      reason: reviewReason,
    });
  } else if (await startGuideInvite(venueId, leadId)) {
    // The gated "Send me my guide" email went out instead. Their tap is the SMS
    // opt-in and starts Phase 1 + Phase 2 exactly like a listing-form lead; no
    // tap by 48h → guide by email and Phase 2 without SMS (lib/guide-invite).
  } else {
    // The venue can't text (or the invite couldn't go out): today's behaviour.
    void sendBookingSystemGuide(venueId, leadId, { channels: 'email' }).catch((e) =>
      console.error('[leadfinder] guide send failed:', e),
    );

    // ── 9. Booking System workflow ─────────────────────────────────────────
    // Same enrollment a form submission gets. The steps that would text the
    // couple are refused downstream by the sms_consent gate.
    try {
      const formId = await ensureListingForm(venueId);
      if (formId) {
        await onMarketingFormSubmitted(venueId, leadId, formId);
      } else {
        console.warn('[leadfinder] no listing form for venue — workflow not triggered', { venueId });
      }
    } catch (e) {
      console.error('[leadfinder] workflow trigger failed:', e);
    }
  }

  // The owner's own copy, fired last so the banner reflects the final state of
  // the arrival (including whether it is waiting on a human check).
  await mirror({ kind: 'lead', created: true, leadId, leadName: displayName, needsReview, reviewReason });

  return { outcome: 'created', leadId, detectedSource, confidence: verdict.confidence };
}
