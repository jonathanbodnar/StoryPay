import { supabaseAdmin } from '@/lib/supabase';

/**
 * May we send THIS LEAD an automated text?
 *
 * Until now every send path inferred permission from a phone number being
 * present. That is true for a number someone typed into our own form, and false
 * for a number LeadFinder read out of a forwarded directory email — the couple
 * gave that to the directory, not to us, and it is not TCPA consent.
 *
 * So permission is now an explicit fact on the lead (`leads.sms_consent`,
 * migration 255) and every automated SMS path asks here first.
 *
 * Three-state reasoning, because "no value" and "no" are different things:
 *
 *   true        → text them.
 *   false       → do NOT text, they have not opted in.
 *   null/missing→ text them. This is the tolerant-reader default: the column
 *                 default is true, so a null only appears on a row written
 *                 before migration 255 reached it. Treating it as "no" would
 *                 silently mute automated texting across the whole platform.
 */

/** What granted or revoked consent — stored for the audit trail. */
export type SmsConsentSource =
  | 'form_submit'
  | 'inbound_reply'
  | 'inbound_sms'
  | 'inbound_start_keyword'
  | 'inbound_stop_keyword'
  | 'leadfinder_forwarded_email'
  | 'manual';

/**
 * The tolerant reader. Only an explicit `false` blocks a send.
 *
 * Fails CLOSED on an unexpected database error (we could not prove consent, so
 * we do not text — the cost is one skipped automated message) with exactly one
 * exception: if the column does not exist yet the migration has not been applied,
 * and failing closed would mute automated SMS platform-wide. Deploy order must
 * never be able to do that, so that one case fails open and matches today's
 * behaviour.
 */
export async function leadSmsAllowed(leadId: string): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('sms_consent')
      .eq('id', leadId)
      .maybeSingle();

    // Column not migrated yet (42703 undefined_column) — behave as before.
    if (error) {
      if (isMissingColumnError(error)) return true;
      console.error('[sms-consent] lead lookup failed, blocking send:', error.message, { leadId });
      return false;
    }

    // No such lead — don't block on a lookup miss; the caller's own checks decide.
    if (!data) return true;

    return (data as { sms_consent?: boolean | null }).sms_consent !== false;
  } catch (e) {
    console.error('[sms-consent] lead lookup threw, blocking send:', e, { leadId });
    return false;
  }
}

/**
 * Record that a lead may (or may no longer) be texted. Idempotent: writing the
 * same value twice leaves the original timestamp and source intact, so the audit
 * trail always shows when consent was actually established.
 */
export async function recordLeadSmsConsent(input: {
  leadId: string;
  allowed: boolean;
  source: SmsConsentSource;
}): Promise<void> {
  const { leadId, allowed, source } = input;
  try {
    const patch: Record<string, unknown> = {
      sms_consent:        allowed,
      sms_consent_at:     new Date().toISOString(),
      sms_consent_source: source,
    };

    // Only touch rows whose value actually changes — keeps repeated replies and
    // duplicate webhook deliveries from churning the audit columns.
    const { error } = await supabaseAdmin
      .from('leads')
      .update(patch)
      .eq('id', leadId)
      .neq('sms_consent', allowed);

    if (error && !isMissingColumnError(error)) {
      console.warn('[sms-consent] could not record consent:', error.message, { leadId, source });
    }
  } catch (e) {
    console.warn('[sms-consent] record threw (non-fatal):', e, { leadId, source });
  }
}

/**
 * The same, for the paths that know a contact's email but not which lead row the
 * message belongs to — an inbound reply or a form submission arrives attributed
 * to a person, and they may own several leads at this venue.
 *
 * Replying or submitting a form is the opt-in signal, so this only ever grants;
 * it never revokes. A blast radius of "every unconsumed lead for this one email
 * at this one venue" is intended: they are the same human.
 */
export async function recordSmsConsentByEmail(input: {
  venueId: string;
  email: string;
  source: SmsConsentSource;
}): Promise<void> {
  const email = (input.email || '').trim().toLowerCase();
  if (!email) return;
  try {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('id')
      .eq('venue_id', input.venueId)
      .ilike('email', email)
      .eq('sms_consent', false);

    if (error) {
      if (!isMissingColumnError(error)) {
        console.warn('[sms-consent] opt-in lookup failed:', error.message, { venueId: input.venueId });
      }
      return;
    }

    const ids = (data ?? []).map((r) => (r as { id: string }).id);
    await grantSmsConsentForLeadIds({ venueId: input.venueId, leadIds: ids, source: input.source });
  } catch (e) {
    console.warn('[sms-consent] opt-in by email threw (non-fatal):', e, { venueId: input.venueId });
  }
}

/**
 * Grant consent to a known set of leads. One bulk write, then the follow-up
 * resume below — shared by the email matcher and by the TCPA opt-in path in
 * sms-compliance.ts so both produce identical behaviour.
 *
 * Only rows currently set to false are touched, so repeated replies and
 * duplicate webhook deliveries don't churn the audit columns.
 */
export async function grantSmsConsentForLeadIds(input: {
  venueId: string;
  leadIds: string[];
  source: SmsConsentSource | string;
}): Promise<void> {
  const ids = input.leadIds.filter(Boolean);
  if (ids.length === 0) return;
  try {
    const { error } = await supabaseAdmin
      .from('leads')
      .update({
        sms_consent:        true,
        sms_consent_at:     new Date().toISOString(),
        sms_consent_source: input.source,
      })
      .in('id', ids)
      .eq('sms_consent', false);

    if (error) {
      // Undefined column simply means migration 255 hasn't been applied yet.
      if (!isMissingColumnError(error)) {
        console.warn('[sms-consent] grant failed:', error.message, { venueId: input.venueId });
      }
      return;
    }

    console.log('[sms-consent] opted in', ids.length, 'lead(s) via', input.source, { venueId: input.venueId });
    // Now that they may be texted, let the premises that were skipped for lack of
    // consent pick them up — a captured lead whose venue runs the AI Concierge
    // should start being engaged from here, not stay silent forever.
    for (const id of ids) void resumeConsentGatedFollowUp(input.venueId, id);
  } catch (e) {
    console.warn('[sms-consent] grant threw (non-fatal):', e, { venueId: input.venueId });
  }
}

/**
 * Consent arriving late means anything we deliberately skipped earlier needs a
 * second look. Today that is the AI Concierge: the activation workflow step is
 * refused for a lead without consent, so without this the lead would sit dormant
 * until someone manually re-ran the workflow.
 *
 * Deliberately lazy-imported to keep this module dependency-light, and every
 * failure is swallowed — a missed re-activation must never break the reply or
 * form submission that triggered it.
 */
async function resumeConsentGatedFollowUp(venueId: string, leadId: string): Promise<void> {
  try {
    const { setLeadAiState } = await import('@/lib/ai-concierge/state-control');
    const result = await setLeadAiState({
      leadId,
      venueId,
      newState:    'ai_active',
      reason:      'sms_consent_granted',
      triggeredBy: 'sms_consent:opt_in',
    });
    if (result?.ok) {
      console.log('[sms-consent] resumed AI Concierge for', leadId, '(consent granted)');
    }
  } catch {
    /* best-effort: consent is recorded either way and a human can re-enable */
  }
}

/** Supabase surfaces an undefined column as Postgres 42703. */
function isMissingColumnError(error: { code?: string; message?: string }): boolean {
  return error.code === '42703'
    || /column .* does not exist/i.test(error.message ?? '')
    || /Could not find the '.*' column/i.test(error.message ?? '');
}
