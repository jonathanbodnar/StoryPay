/**
 * Shared post-ingest side effects for inbound GHL SMS.
 *
 * Both webhook entry points (the marketplace `/api/webhooks/ghl` route and the
 * per-location workflow webhook `/api/webhooks/ghl-workflow-inbound`) must run
 * the exact same follow-up work after an inbound SMS is stored:
 *   1. TCPA keyword routing (STOP → DND + Not Interested + AI halt, START → re-opt-in), synced to GHL.
 *   2. SMS reply attribution (credit the automated step that earned the reply).
 *   3. AI Concierge state machine (plan-gated; only for freshly-inserted rows).
 *
 * Extracted so the two routes can't drift. Best-effort: failures are logged,
 * never thrown — the message is already safely stored by the time this runs.
 */

import {
  applySmsDndForVenueCustomer,
  applySmsOptInForVenueCustomer,
  isSmsOptOutKeyword,
  isSmsOptInKeyword,
} from '@/lib/sms-compliance';
import { recordSmsReplyAttribution } from '@/lib/sms-reply-tracking';
import { loadVenueFeatureAccess } from '@/lib/plan-features';
import { handleInboundAiMessage } from '@/lib/ai-concierge/inbound-handler';
import { moveLeadToAiStage } from '@/lib/ai-concierge/pipeline-tag-service';
import { insertLeadActivity } from '@/lib/lead-activity';
import { supabaseAdmin } from '@/lib/supabase';
import { normalizePhone } from '@/lib/ghl';

const PLACEHOLDER_SMS_EMAIL = '@ghl-sms.storypay.placeholder';

/**
 * Full STOP-keyword handler for an inbound SMS.
 *
 * Runs when the message body matches a TCPA opt-out keyword (STOP, STOPALL,
 * UNSUBSCRIBE, CANCEL, END, QUIT). In addition to the standard DND flip this
 * function also:
 *   1. Sets `sms_dnd = true` + `ai_state = 'opted_out'` on matching leads
 *      (delegated to `applySmsDndForVenueCustomer`).
 *   2. Moves every linked lead to the venue's "Not Interested" pipeline stage.
 *   3. Logs an `sms_stop_received` activity row for each lead so the
 *      concierge team has a clear audit trail.
 *
 * Returns `true` when the body is a STOP keyword (caller can use this to
 * skip further AI processing), `false` otherwise.
 *
 * Best-effort: sub-step failures are caught and logged; they never throw.
 */
export async function handleStopKeyword(params: {
  venueId: string;
  venueCustomerId: string;
  messageBody: string;
  logPrefix: string;
}): Promise<boolean> {
  const { venueId, venueCustomerId, messageBody, logPrefix } = params;

  if (!isSmsOptOutKeyword(messageBody)) return false;

  // 1. Set SMS DND + ai_state = 'opted_out' on venue_customer + matching leads + push to GHL
  try {
    await applySmsDndForVenueCustomer({
      venueId,
      venueCustomerId,
      source: 'inbound_stop_keyword',
    });
  } catch (err) {
    console.error(`${logPrefix} STOP: applySmsDndForVenueCustomer failed:`, err);
  }

  // 2. Resolve leads linked to this venue_customer, then move to Not Interested + log activity
  try {
    const { data: vcRow } = await supabaseAdmin
      .from('venue_customers')
      .select('customer_email, phone')
      .eq('id', venueCustomerId)
      .eq('venue_id', venueId)
      .maybeSingle();

    if (!vcRow) return true;

    const vc = vcRow as { customer_email: string | null; phone: string | null };
    const email = (vc.customer_email ?? '').trim().toLowerCase();
    const phoneNorm = normalizePhone(vc.phone);

    // Collect lead IDs via email match, then phone match
    const leadIds = new Set<string>();

    if (email && !email.endsWith(PLACEHOLDER_SMS_EMAIL)) {
      const { data: emailLeads } = await supabaseAdmin
        .from('leads')
        .select('id')
        .eq('venue_id', venueId)
        .ilike('email', email);
      for (const row of emailLeads ?? []) leadIds.add(String((row as { id: string }).id));
    }

    if (phoneNorm) {
      const { data: phoneCandidates } = await supabaseAdmin
        .from('leads')
        .select('id, phone')
        .eq('venue_id', venueId);
      for (const row of phoneCandidates ?? []) {
        const r = row as { id: string; phone: string | null };
        if (normalizePhone(r.phone) === phoneNorm) leadIds.add(r.id);
      }
    }

    if (leadIds.size === 0) return true;

    const note = 'Lead replied STOP — SMS DND enabled, moved to Not Interested, AI halted.';

    for (const leadId of leadIds) {
      // Move to "Not Interested" AI pipeline stage (fires onMarketingStageChanged + vc mirror)
      void moveLeadToAiStage(venueId, leadId, 'not_interested').catch((err) => {
        console.error(`${logPrefix} STOP: moveLeadToAiStage failed for lead ${leadId}:`, err);
      });

      // Audit trail
      void insertLeadActivity({
        venueId,
        leadId,
        actorMemberId: null,
        actorIsOwner: false,
        action: 'sms_stop_received',
        details: { note, venue_customer_id: venueCustomerId },
      }).catch((err) => {
        console.error(`${logPrefix} STOP: insertLeadActivity failed for lead ${leadId}:`, err);
      });
    }
  } catch (err) {
    console.error(`${logPrefix} STOP: stage move / activity log failed:`, err);
  }

  return true;
}

export async function runInboundGhlSmsSideEffects(params: {
  venueId: string;
  venueCustomerId: string;
  messageBody: string;
  ghlMessageId: string | null;
  /** True when the message row was newly inserted (not a dedupe no-op).
   *  Attribution + AI only run for fresh inserts; TCPA keywords always run. */
  inserted: boolean;
  /** Log prefix so failures are attributable to the entry point. */
  logPrefix: string;
}): Promise<void> {
  const { venueId, venueCustomerId, messageBody, ghlMessageId, inserted, logPrefix } = params;

  // TCPA keyword routing — runs FIRST so the AI inbound handler sees the
  // correct dnd/ai_state. STOP is fully handled (DND + stage + activity);
  // START clears DND and restores the AI state.
  try {
    const wasStop = await handleStopKeyword({ venueId, venueCustomerId, messageBody, logPrefix });
    if (!wasStop && isSmsOptInKeyword(messageBody)) {
      await applySmsOptInForVenueCustomer({
        venueId,
        venueCustomerId,
        source: 'inbound_start_keyword',
      });
    }
  } catch (err) {
    console.error(`${logPrefix} TCPA keyword routing failed:`, err);
  }

  if (!inserted) return;

  // SMS reply attribution — no-ops when there was no prior automated send.
  void recordSmsReplyAttribution({ venueId, venueCustomerId }).catch((err) => {
    console.error(`${logPrefix} SMS reply attribution failed:`, err);
  });

  // AI Concierge — plan-gated: venues without SMS never route inbound replies
  // through the AI or to the super-admin inbox.
  try {
    const access = await loadVenueFeatureAccess(venueId);
    if (access.hasSms) {
      void handleInboundAiMessage({
        venueId,
        venueCustomerId,
        messageBody,
        ghlMessageId,
      }).catch((err) => {
        console.error(`${logPrefix} AI inbound handler failed:`, err);
      });
    } else {
      console.log(`${logPrefix} inbound SMS stored but AI routing skipped for venue ${venueId}: plan has no SMS`);
    }
  } catch (err) {
    console.error(`${logPrefix} AI plan gate failed:`, err);
  }
}
