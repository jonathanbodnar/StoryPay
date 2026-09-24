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
import { applySystemTags, ensureSystemTagsForVenue } from '@/lib/system-tags';
import { logNewLeadOpportunity, sendBookingSystemGuide, onMarketingFormSubmitted } from '@/lib/marketing-email-worker';
import { notifyOwnerNewLead } from '@/lib/owner-notifications';
import { dispatchIntegrationEvent } from '@/lib/integration-events';
import { maybePushLeadToTripleseat } from '@/lib/tripleseat';
import { ensureListingForm } from '@/lib/listing-lead-form';
import { leadFinderEnabledForSlug } from '@/lib/leadfinder/address';
import {
  classifyInbound,
  domainOf,
  extractLeadFromEmail,
  sourceForDomain,
  type ExtractedLead,
} from '@/lib/leadfinder/extract';
import {
  extractWithAi,
  needsAiFallback,
  scoreExtractedFields,
  type AiExtractedFields,
} from '@/lib/leadfinder/ai-extract';
import { mirrorArrivalToVenue, type MirrorOutcome } from '@/lib/leadfinder/mirror';

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
  /** Display name from the From header, when the sender provided one. */
  senderName?: string | null;
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

/**
 * The line between "send the guide now" and "ask a human first".
 *
 * At or above this, the extracted fields are complete enough to trust the way
 * we always have. Below it we still create the lead and still alert the owner —
 * a venue must never miss an arrival — but we hold the couple-facing follow-up
 * until a person confirms the record is right.
 */
const CONFIDENCE_THRESHOLD = 0.75;

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

/**
 * Fill ONLY the gaps the deterministic pass left. Deterministic precedence is
 * absolute: a field the parser read is never overwritten by the model, so a
 * later AI guess can never degrade something we already know. Returns true when
 * the AI contributed at least one field — which is what `extraction_source`
 * records.
 */
function applyAiGapFill(target: ExtractedLead, ai: AiExtractedFields): boolean {
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
 * Mirror the enquiry answers onto the contact record.
 *
 * The lead is not where the profile UI reads from: the Contact profile's Event
 * Details card is populated from `venue_customers`. A lead alone is therefore
 * invisible in those boxes, which is what made a captured guest count and
 * wedding date look like they had never arrived.
 *
 * Only fields we actually have are written, so a later email that is missing a
 * phone can never blank one the venue already had.
 *
 * Best-effort and deliberately separate from the lead write: an unknown column
 * on an older deploy fails only this statement, not the lead itself.
 */
async function mirrorToVenueCustomer(
  venueId: string,
  email: string,
  e: ExtractedLead,
): Promise<void> {
  const key = email.toLowerCase();
  try {
    const row: Record<string, unknown> = {
      venue_id: venueId,
      customer_email: key,
      updated_at: new Date().toISOString(),
    };
    if (e.firstName) row.first_name = e.firstName;
    if (e.lastName) row.last_name = e.lastName;
    if (e.phone) row.phone = e.phone;
    if (e.guestCount !== null) row.guest_count = e.guestCount;

    const { error } = await supabaseAdmin
      .from('venue_customers')
      .upsert(row, { onConflict: 'venue_id,customer_email' });
    if (error) console.warn('[leadfinder] venue_customers upsert:', error.message);
  } catch (err) {
    console.warn('[leadfinder] venue_customers upsert threw:', err);
  }

  // The enquiry answers live in a separate update, matching how the public lead
  // path does it. `wedding_date` is included here even though the public form
  // never sends one (it is deliberately left blank as a reason to call) — when
  // an email does disclose a date, there is no reason to discard it.
  const inquiry: Record<string, string> = {};
  if (e.timeline)     inquiry.booking_timeline = e.timeline;
  if (e.venueMatters) inquiry.venue_matters = e.venueMatters;
  if (e.weddingDate)  inquiry.wedding_date = e.weddingDate;

  if (Object.keys(inquiry).length > 0) {
    try {
      const { error } = await supabaseAdmin
        .from('venue_customers')
        .update(inquiry)
        .eq('venue_id', venueId)
        .eq('customer_email', key);
      if (error) console.warn('[leadfinder] venue_customers inquiry update:', error.message);
    } catch (err) {
      console.warn('[leadfinder] venue_customers inquiry update threw:', err);
    }
  }
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
    source: 'leadfinder',
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

export async function ingestLeadFinderEmail(
  input: LeadFinderIngestInput,
): Promise<LeadFinderIngestResult> {
  const { venueId } = input;

  // ── 1. Resolve the venue ─────────────────────────────────────────────────
  // Checked before anything is stored: when the feature is off we should not be
  // accumulating inbound email for a hundred venues that are not using it.
  const { data: venueRow } = await supabaseAdmin
    .from('venues')
    .select('id, slug, name, notification_email, email, leadfinder_mirror_enabled')
    .eq('id', venueId)
    .maybeSingle();

  if (!venueRow) return { outcome: 'skipped', reason: 'venue_not_found' };
  const venue = venueRow as {
    slug: string | null;
    name: string | null;
    notification_email: string | null;
    email: string | null;
    leadfinder_mirror_enabled: boolean | null;
  };

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

  // Everything the mirror needs, captured once. The mirror is deliberately built
  // from the SAME stored arrival (subject/sender/receivedAt/rawText) so its copy
  // is faithful, and it is fired on EVERY terminal outcome — created, updated,
  // skipped and failed — because the point is that the owner can see what
  // LeadFinder did or did not take. Idempotency lives in the mirror itself
  // (an atomic claim on `mirrored_at`), so calling it from each path is safe.
  const mirror = (outcome: MirrorOutcome): Promise<void> =>
    mirrorArrivalToVenue(
      {
        venueId,
        importId,
        recipient: venue.notification_email || venue.email || null,
        // Tolerant reader: a deploy without the column (null) keeps mirroring ON,
        // matching the database DEFAULT.
        enabled: venue.leadfinder_mirror_enabled !== false,
        subject: input.subject,
        sender: input.fromRaw,
        originalReplyTo: input.replyTo,
        receivedAt: input.receivedAt,
        rawText: input.text.slice(0, 200_000),
      },
      outcome,
    );

  const fail = async (reason: string, message?: string): Promise<LeadFinderIngestResult> => {
    await supabaseAdmin
      .from('leadfinder_imports')
      .update({ processing_status: 'failed', failure_reason: message ?? reason })
      .eq('id', importId);
    await mirror({ kind: 'failed', reason });
    return { outcome: 'failed', reason };
  };
  const skip = async (reason: string): Promise<LeadFinderIngestResult> => {
    await supabaseAdmin
      .from('leadfinder_imports')
      .update({ processing_status: 'skipped', failure_reason: reason })
      .eq('id', importId);
    await mirror({ kind: 'skipped', reason });
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
      senderName: input.senderName ?? null,
    });
    verdict = classifyInbound({ subject: input.subject, senderDomain, extracted });
  } catch (e) {
    console.error('[leadfinder] extract threw:', e);
    return fail('extract_threw');
  }

  if (!verdict.accept) return skip(verdict.reason ?? 'rejected');

  const detectedSource = verdict.detectedSource ?? sourceForDomain(senderDomain);
  const email = extracted.email as string;   // classifier guarantees non-null

  // ── 5b. AI fallback — only for a thin result that is still a real inquiry ──
  // The deterministic parser stays primary: it reads the known marketplace
  // shapes exactly. We reach for the model ONLY when that came back thin AND
  // the message is one we are actually going to keep (an email address is
  // present — the classifier already rejected anything without one, so this
  // never runs for a message that is about to be skipped).
  let aiContributed = false;
  if (needsAiFallback(extracted)) {
    const ai = await extractWithAi({
      subject: input.subject,
      text: input.text,
      senderEmail: email,
      senderDisplayName: input.senderName ?? null,
    });
    if (ai) aiContributed = applyAiGapFill(extracted, ai.fields);
  }

  const { overallConfidence: extractionConfidence, fieldConfidence } = scoreExtractedFields(extracted);
  const extractionSource = aiContributed ? 'ai' : 'deterministic';

  // ── 5c. Confidence routing ───────────────────────────────────────────────
  // THE BEHAVIOURAL CHANGE. Until now every accepted message fired the whole
  // follow-up, guide included, no matter how little we had actually read. Now
  // the extraction confidence decides how far the pipeline may go on its own:
  //
  //   ≥ 0.75 → exactly today's behaviour: create/update the lead, fire the full
  //            owner notification fan-out, and send the pricing guide.
  //   <  0.75 → STILL create the lead and STILL fire the full owner fan-out
  //            (the venue owner must always learn about an arrival), but mark
  //            the arrival `needs_review` and DO NOT send the guide and DO NOT
  //            enroll the automated workflow. A human confirms before the
  //            couple is contacted on a guess.
  //
  // A message with no email address is untouched by all of this: it is still
  // rejected and recorded exactly as before, above.
  const needsReview = extractionConfidence < CONFIDENCE_THRESHOLD;
  const reviewReason = needsReview
    ? aiContributed ? 'ai_fallback_uncertain' : 'low_confidence'
    : null;

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
      await mirrorToVenueCustomer(venueId, email, extracted);

      const existingName =
        ((existing as { name?: string | null }).name ?? '').trim() || extracted.name || email;
      await mirror({ kind: 'lead', created: false, leadId: existingId, leadName: existingName, needsReview: false });

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
      // The couple gave this number to a directory, not to us, so it is not
      // consent for an automated text. Every automated SMS path checks this
      // before sending; a reply or a form submission flips it to true.
      sms_consent:        false,
      sms_consent_at:     new Date().toISOString(),
      sms_consent_source: 'leadfinder_forwarded_email',
      updated_at: new Date().toISOString(),
    })
    .select('id, created_at')
    .maybeSingle();

  if (createErr || !created) {
    console.error('[leadfinder] lead insert failed:', createErr?.message);
    return fail('lead_insert_failed', createErr?.message);
  }
  const leadId = (created as { id: string }).id;
  const createdAt = (created as { created_at?: string }).created_at ?? input.receivedAt.toISOString();

  // Notify the venue owner exactly like every other entry point does. Fired
  // right after the row exists so the push/SMS lands as fast as it does for a
  // form or directory inquiry — the profile sync and bookkeeping below can take
  // their time without delaying the alert.
  notifyNewLeadLikeEveryOtherEntryPoint({
    venueId,
    leadId,
    fullName: displayName,
    email,
    phone: extracted.phone,
    createdAt,
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
  await mirrorToVenueCustomer(venueId, email, extracted);

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
  // guide goes out by EMAIL ONLY.
  //
  // A phone number read out of a forwarded directory email is not consent for an
  // automated text, so LeadFinder leads are never auto-enrolled into SMS. A
  // phone-less lead would skip the SMS step anyway; this stops the ones that DO
  // carry a number from being texted without the couple asking for it. Her
  // replying to the guide is the consent signal that can change that later.
  void ensureSystemTagsForVenue(venueId)
    .then(() => applySystemTags(venueId, leadId, ['new_lead', 'inquiry_received', 'email_lead']))
    .catch((e) => console.error('[leadfinder] system tags failed:', e));

  // The "New Lead Opportunity!" marker, so the lead's thread opens with what
  // they submitted (same as a form or directory lead).
  await logNewLeadOpportunity(venueId, leadId, input.receivedAt.toISOString());

  // EVERYTHING BELOW THIS LINE CONTACTS THE COUPLE. Below the confidence
  // threshold we hold all of it — the guide AND the automated workflow (which
  // sends emails of its own) — until a human confirms. The internal steps above
  // (system tags, the in-app "New Lead Opportunity" marker) have already run
  // regardless, so the owner still sees the arrival and the lead still moves
  // through the inbox exactly like any other.
  if (needsReview) {
    console.warn('[leadfinder] holding couple follow-up pending review', {
      venueId,
      importId,
      leadId,
      confidence: extractionConfidence,
      reason: reviewReason,
    });
  } else {
    void sendBookingSystemGuide(venueId, leadId, { channels: 'email' }).catch((e) =>
      console.error('[leadfinder] guide send failed:', e),
    );

    // ── 9. Booking System workflow ─────────────────────────────────────────
    // Same enrollment a form submission gets, so the lead moves through the
    // venue's stages and nurture sequence exactly like any other. The steps that
    // would text the couple are refused downstream by the sms_consent gate above,
    // so enrolling here cannot produce an unconsented message.
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
  await mirror({ kind: 'lead', created: true, leadId, leadName: displayName, needsReview });

  return { outcome: 'created', leadId, detectedSource, confidence: verdict.confidence };
}
