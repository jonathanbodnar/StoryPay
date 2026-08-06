/**
 * Shared post-ingest side effects for inbound GHL SMS.
 *
 * Both webhook entry points (the marketplace `/api/webhooks/ghl` route and the
 * per-location workflow webhook `/api/webhooks/ghl-workflow-inbound`) must run
 * the exact same follow-up work after an inbound SMS is stored:
 *   1. TCPA keyword routing (STOP → DND, START → re-opt-in), synced to GHL.
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
  // correct dnd state. Both STOP and START sync bidirectionally with GHL.
  try {
    if (isSmsOptOutKeyword(messageBody)) {
      await applySmsDndForVenueCustomer({
        venueId,
        venueCustomerId,
        source: 'inbound_stop_keyword',
      });
    } else if (isSmsOptInKeyword(messageBody)) {
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
