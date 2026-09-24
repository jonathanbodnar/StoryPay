/**
 * StoryVenue LeadFinder™ — from an inbound message to a lead.
 *
 * Flow: check the flag → record the arrival → extract → classify → dedupe →
 * create or update the lead → update the arrival row.
 *
 * Two rules shape the whole thing:
 *
 *   1. The arrival row is written BEFORE any processing, so nothing is lost to a
 *      webhook retry, a timeout, or a crash. Its status is the record of what
 *      happened, which makes a replay possible.
 *   2. Nothing is thrown away silently. A message that does not become a lead is
 *      marked `skipped` WITH a reason, so it can be inspected rather than
 *      vanishing.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { findMatchingLeadIds } from '@/lib/find-matching-leads';
import { leadFinderEnabledForSlug } from '@/lib/leadfinder/address';
import {
  classifyInbound,
  domainOf,
  extractLeadFromEmail,
  sourceForDomain,
  type ExtractedLead,
} from '@/lib/leadfinder/extract';

export interface LeadFinderIngestInput {
  venueId: string;
  fromRaw: string;
  replyTo: string | null;
  subject: string | null;
  text: string;
  inReplyTo: string | null;
  references: string | null;
  messageId: string | null;
  /** Fallback dedupe key when the sender gave no Message-ID. */
  dedupeFallbackId: string | null;
  receivedAt: Date;
}

export interface LeadFinderIngestResult {
  outcome: 'created' | 'updated' | 'skipped' | 'duplicate' | 'disabled' | 'failed';
  leadId?: string | null;
  reason?: string | null;
  detectedSource?: string | null;
  confidence?: number;
}

const PARSER_VERSION = 'deterministic-v1';

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

export async function ingestLeadFinderEmail(
  input: LeadFinderIngestInput,
): Promise<LeadFinderIngestResult> {
  const { venueId } = input;

  // ── 1. Resolve the venue ─────────────────────────────────────────────────
  // Checked before anything is stored: when the feature is off we should not be
  // accumulating inbound email for a hundred venues that are not using it.
  const { data: venueRow } = await supabaseAdmin
    .from('venues')
    .select('id, slug, name, notification_email, email')
    .eq('id', venueId)
    .maybeSingle();

  if (!venueRow) return { outcome: 'skipped', reason: 'venue_not_found' };
  const venue = venueRow as { slug: string | null; name: string | null };

  // ── 2. Idempotency ───────────────────────────────────────────────────────
  const messageId = input.messageId?.replace(/^<|>$/g, '').trim() || input.dedupeFallbackId;
  if (messageId) {
    const { data: seen } = await supabaseAdmin
      .from('leadfinder_imports')
      .select('id, lead_id, processing_status')
      .eq('venue_id', venueId)
      .eq('original_message_id', messageId)
      .maybeSingle();
    if (seen) {
      return {
        outcome: 'duplicate',
        leadId: (seen as { lead_id: string | null }).lead_id,
        reason: 'already_imported',
      };
    }
  }

  // ── 3. Record the arrival before doing anything with it ──────────────────
  const senderDomain = domainOf(input.fromRaw);
  const { data: insertedImport, error: insertErr } = await supabaseAdmin
    .from('leadfinder_imports')
    .insert({
      venue_id: venueId,
      sender: input.fromRaw,
      sender_domain: senderDomain,
      reply_to: input.replyTo,
      original_message_id: messageId,
      in_reply_to: input.inReplyTo,
      email_references: input.references,
      subject: input.subject,
      received_at: input.receivedAt.toISOString(),
      raw_text: input.text.slice(0, 200_000),
      processing_status: 'pending',
    })
    .select('id')
    .maybeSingle();

  // A unique-violation here means a concurrent delivery won the race — treat it
  // as the duplicate it is rather than failing the request.
  if (insertErr && /duplicate key|unique/i.test(insertErr.message)) {
    return { outcome: 'duplicate', reason: 'already_imported' };
  }
  if (insertErr || !insertedImport) {
    console.error('[leadfinder] could not record import:', insertErr?.message);
    return { outcome: 'failed', reason: 'import_row_failed' };
  }
  const importId = (insertedImport as { id: string }).id;

  const fail = async (reason: string, message?: string): Promise<LeadFinderIngestResult> => {
    await supabaseAdmin
      .from('leadfinder_imports')
      .update({ processing_status: 'failed', failure_reason: message ?? reason })
      .eq('id', importId);
    return { outcome: 'failed', reason };
  };
  const skip = async (reason: string): Promise<LeadFinderIngestResult> => {
    await supabaseAdmin
      .from('leadfinder_imports')
      .update({ processing_status: 'skipped', failure_reason: reason })
      .eq('id', importId);
    return { outcome: 'skipped', reason };
  };

  // ── 4. Is this venue switched on? ────────────────────────────────────────
  // Checked AFTER recording the arrival, deliberately. Returning early instead
  // would mean a message sent while the feature is off leaves no trace at all,
  // which makes "I sent one and nothing happened" impossible to diagnose. The
  // address can only be minted by us, so the volume this can accumulate is
  // inherently bounded to venues that actually have it.
  if (!leadFinderEnabledForSlug(venue.slug)) {
    return skip('leadfinder_disabled_for_venue');
  }

  // ── 5. Extract and classify ──────────────────────────────────────────────
  let extracted: ExtractedLead;
  let verdict;
  try {
    extracted = extractLeadFromEmail({
      subject: input.subject,
      text: input.text,
      senderName: null,
    });
    verdict = classifyInbound({ subject: input.subject, senderDomain, extracted });
  } catch (e) {
    console.error('[leadfinder] extract threw:', e);
    return fail('extract_threw');
  }

  if (!verdict.accept) return skip(verdict.reason ?? 'rejected');

  const detectedSource = verdict.detectedSource ?? sourceForDomain(senderDomain);
  const email = extracted.email as string;   // classifier guarantees non-null

  // ── 6. Dedupe against existing leads ─────────────────────────────────────
  const matches = await findMatchingLeadIds({
    venueId,
    email,
    phone: extracted.phone,
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
      .select('id, first_name, last_name, guest_count, wedding_date, venue_matters, booking_timeline, message, phone')
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
      await supabaseAdmin
        .from('leadfinder_imports')
        .update({
          processing_status: 'processed',
          lead_id: existingId,
          detected_source: detectedSource,
          parser_version: PARSER_VERSION,
          extraction_source: 'deterministic',
          classification_confidence: verdict.confidence,
        })
        .eq('id', importId);
      return { outcome: 'updated', leadId: existingId, detectedSource, confidence: verdict.confidence };
    }
  }

  // ── 7. Create the lead ───────────────────────────────────────────────────
  // `name` is NOT NULL with no default, so fall back to a readable derivation of
  // the email rather than storing an empty string.
  const displayName = extracted.name || nameFromEmail(email);

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
      status: 'new',
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .maybeSingle();

  if (createErr || !created) {
    console.error('[leadfinder] lead insert failed:', createErr?.message);
    return fail('lead_insert_failed', createErr?.message);
  }
  const leadId = (created as { id: string }).id;

  await supabaseAdmin
    .from('leadfinder_imports')
    .update({
      processing_status: 'processed',
      lead_id: leadId,
      detected_source: detectedSource,
      parser_version: PARSER_VERSION,
      extraction_source: 'deterministic',
      classification_confidence: verdict.confidence,
    })
    .eq('id', importId);

  return { outcome: 'created', leadId, detectedSource, confidence: verdict.confidence };
}
