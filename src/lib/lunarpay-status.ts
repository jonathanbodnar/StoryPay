/**
 * Canonical LunarPay onboarding statuses stored on `venues.onboarding_status`.
 *
 * The DB column previously overloaded the word "pending" to mean two very
 * different states, which caused confusion between venues that had never
 * started onboarding vs. venues that had registered a merchant and were
 * waiting for Fortis underwriting. The values below are the only ones that
 * should ever be written to the column going forward.
 *
 *   not_started           — venue exists but has no LunarPay merchant
 *   registered            — merchant created at LunarPay, MPA form not yet
 *                           submitted (Fortis has nothing to review yet)
 *   bank_information_sent — venue submitted Step 2 (banking/MPA), waiting
 *                           on the MPA signature iframe
 *   under_review          — MPA submitted, Fortis is underwriting
 *   active                — approved + API keys on file (can charge)
 *   denied                — Fortis rejected the application
 *
 * LunarPay's Agency API (`GET /agency/merchants/:id`) already canonicalizes
 * Fortis's internal states to a small set: PENDING, BANK_INFORMATION_SENT,
 * PENDING_REVIEW, ACTIVE, DENIED. It does NOT leak raw Fortis strings like
 * DOCUMENTATION_REQUIRED — the extra synonym branches in
 * `normalizeLunarPayStatus()` below are defensive (older StoryPay code paths
 * and manual DB edits over time), not something the live API currently sends.
 *
 * The one real ambiguity confirmed with LunarPay: their PENDING value is
 * returned BOTH for "merchant exists, no onboarding record at all" and for
 * "merchant registered, banking form not yet submitted" — it's their status
 * fallback when there's nothing else to report, not a Fortis status. We
 * disambiguate the "never started" case by never calling the merchant-fetch
 * endpoint unless `lunarpay_merchant_id` is already set (see the two status
 * routes) — so a bare PENDING from LunarPay always means "registered" here,
 * never "not_started". LunarPay has confirmed a future patch will return
 * `null` instead of PENDING for the no-onboarding-record case; our fallback
 * logic already handles that (an empty/null raw value falls through to the
 * caller-provided `fallback`), so no changes will be needed on our side when
 * that ships.
 */

export const LUNARPAY_STATUSES = [
  'not_started',
  'registered',
  'bank_information_sent',
  'under_review',
  'active',
  'denied',
] as const;

export type LunarPayStatus = (typeof LUNARPAY_STATUSES)[number];

/**
 * Map a raw LunarPay/DB status string into the canonical set.
 *
 * `fallback` is used when `raw` is empty AND we need a default — pass the
 * status that matches the calling context (e.g. "registered" after a
 * successful merchant-create, "not_started" for a brand-new venue row).
 */
export function normalizeLunarPayStatus(
  raw: string | null | undefined,
  fallback: LunarPayStatus = 'not_started',
): LunarPayStatus {
  const s = (raw ?? '').toString().trim().toLowerCase().replace(/\s+/g, '_');

  if (!s) return fallback;

  // Direct canonical match
  if ((LUNARPAY_STATUSES as readonly string[]).includes(s)) {
    return s as LunarPayStatus;
  }

  // Known LunarPay / Fortis raw values → canonical
  if (s === 'active' || s === 'approved' || s === 'live') return 'active';
  if (s === 'denied' || s === 'rejected' || s.startsWith('denied_')) return 'denied';
  if (
    s === 'in_review' ||
    s === 'underwriting' ||
    s === 'under_review' ||
    s === 'pending_review' ||
    s === 'documentation_required' ||
    s === 'documents_required' ||
    s === 'more_info_required' ||
    s === 'information_requested'
  ) {
    return 'under_review';
  }
  if (s === 'bank_information_sent' || s === 'bank_details_sent' || s === 'mpa_sent') {
    return 'bank_information_sent';
  }
  if (s === 'registered' || s === 'created' || s === 'new') return 'registered';
  // LunarPay returns "PENDING" immediately after merchant-create, before any
  // onboarding form has been submitted. Treat that as "registered" (merchant
  // exists at LunarPay) rather than the ambiguous "pending".
  if (s === 'pending') return 'registered';

  // Unknown — keep the previous status rather than corrupting state with a
  // string the UI can't render.
  return fallback;
}

/**
 * True when the venue has finished every step the owner can complete and is
 * now waiting on Fortis underwriting (or has been approved/denied).
 */
export function isApplicationSubmitted(status: string | null | undefined): boolean {
  const s = normalizeLunarPayStatus(status);
  return (
    s === 'bank_information_sent' ||
    s === 'under_review' ||
    s === 'active' ||
    s === 'denied'
  );
}
