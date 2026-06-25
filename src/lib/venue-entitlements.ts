/**
 * Venue entitlements — the SINGLE source of truth for "can this venue run the
 * paid Bride Booking System automations?".
 *
 * This is the keystone of the card-gated trial → downgrade-to-Free model:
 *   • Onboarding hard-gates publishing behind a card → 14-day trial.
 *   • Do nothing → LunarPay auto-charges day 14 → 'active' (paid).
 *   • Cancel/downgrade → 'none' on the Free plan → automations OFF, listing +
 *     payment processing stay ON.
 *
 * Historically the only gate on the booking system was the per-venue boolean
 * `booking_system_enabled`, with NO awareness of subscription status. That made
 * "downgrade to Free" cosmetic — a downgraded venue kept getting the full paid
 * system. Every automation firing point now funnels through here so that the
 * billing state actually governs the product.
 *
 * Design principles:
 *   • Fail OPEN for ambiguity. We only DENY on a definite not-entitled signal
 *     ('none' / 'canceled' / mid-checkout / expired trial). Legacy/no-plan rows
 *     and unknown/empty statuses are allowed so we never silently shut off an
 *     existing paying or grandfathered venue.
 *   • 'past_due' is allowed (dunning grace) — a temporary decline at renewal
 *     should not instantly kill a paying customer's system. The trial-sweep /
 *     dunning logic is what eventually drops an unrecoverable card to Free.
 */
import { deriveTrialStatus, type VenueTrialState } from '@/lib/directory-trial';
import { supabaseAdmin } from '@/lib/supabase';

/** Subset of `venues` columns needed to decide booking-system entitlement. */
export type VenueBillingState = {
  directory_plan_id: string | null | undefined;
  directory_subscription_status: string | null | undefined;
  directory_trial_started_at?: string | null;
  directory_trial_ends_at?: string | null;
  directory_trial_is_forever?: boolean | null;
  directory_trial_consumed?: boolean | null;
};

/** Columns to select when loading billing state for an entitlement check. */
export const VENUE_ENTITLEMENT_COLUMNS =
  'directory_plan_id, directory_subscription_status, directory_trial_started_at, directory_trial_ends_at, directory_trial_is_forever, directory_trial_consumed';

/** Statuses that DEFINITELY revoke the paid booking system. */
const NOT_ENTITLED_STATUSES = new Set([
  'none', // downgraded to Free, or never subscribed to a plan
  'canceled',
  'cancelled',
  'pending', // mid-checkout, not yet live/paid
  'pending_payment',
]);

function trialState(v: VenueBillingState): VenueTrialState {
  return {
    directory_trial_started_at: v.directory_trial_started_at ?? null,
    directory_trial_ends_at: v.directory_trial_ends_at ?? null,
    directory_trial_is_forever: Boolean(v.directory_trial_is_forever),
    directory_trial_plan_id: null,
    directory_trial_consumed: Boolean(v.directory_trial_consumed),
  };
}

/**
 * Can this venue run the paid Bride Booking System automations (auto guide
 * delivery, speed-to-lead, AI concierge)? This does NOT consider the per-venue
 * `booking_system_enabled` toggle — callers should AND this with that toggle.
 */
export function canRunBookingSystem(v: VenueBillingState): boolean {
  // Legacy / no-plan rows = full access (existing customers predate billing).
  if (!v.directory_plan_id) return true;

  // Forever trials are never billed and always entitled.
  if (v.directory_trial_is_forever) return true;

  const status = String(v.directory_subscription_status ?? '').trim().toLowerCase();

  // Active trial → entitled; expired trial → not (until the sweep moves them).
  if (status === 'trialing') {
    const t = deriveTrialStatus(trialState(v));
    return t === 'active' || t === 'forever';
  }

  // Definite revoke signals.
  if (NOT_ENTITLED_STATUSES.has(status)) return false;

  // 'active', 'past_due' (dunning grace), and unknown/empty → allow.
  return true;
}

/** True when the venue is on the Free tier (downgraded or never upgraded). */
export function isFreeTier(v: VenueBillingState): boolean {
  if (!v.directory_plan_id) return false; // legacy rows aren't "Free tier"
  if (v.directory_trial_is_forever) return false;
  const status = String(v.directory_subscription_status ?? '').trim().toLowerCase();
  return status === 'none' || status === 'canceled' || status === 'cancelled';
}

/**
 * Load billing state for a venue and decide entitlement in one call. Fails OPEN
 * (returns true) if the row can't be read, so a transient DB hiccup never
 * silently suppresses a paying venue's guide delivery.
 */
export async function venueCanRunBookingSystem(venueId: string): Promise<boolean> {
  try {
    const { data } = await supabaseAdmin
      .from('venues')
      .select(VENUE_ENTITLEMENT_COLUMNS)
      .eq('id', venueId)
      .maybeSingle();
    if (!data) return true;
    return canRunBookingSystem(data as VenueBillingState);
  } catch {
    return true;
  }
}
