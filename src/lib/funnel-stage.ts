/**
 * Shared funnel-stage logic for the card-gated Bride Booking System funnel.
 *
 * SINGLE source of truth so the aggregate funnel counts, the "venues in this
 * stage" drill-down, and the per-venue stage badge in Venue Management all
 * agree. The funnel is cumulative: a venue that reached a later stage also
 * satisfies every earlier stage.
 *
 * Product order:
 *   signed_up → started → details (wrote guide) → activated (sent test inquiry)
 *   → card_shown → card_entered (added a card / went live) → paid.
 */

export interface VenueFunnelState {
  id?: string | null;
  is_published?: boolean | null;
  onboarding_last_step?: number | null;
  onboarding_completed_at?: string | null;
  onboarding_activated_at?: string | null;
  directory_subscription_status?: string | null;
  directory_subscription_external_id?: string | null;
}

/**
 * Statuses that prove a card was vaulted at some point. 'trialing' is
 * deliberately EXCLUDED — signup grants every venue status='trialing' with a
 * null external_id and NO card, so trialing alone is not proof of a card.
 */
export const CARDED_STATUSES = new Set(['active', 'past_due', 'canceled', 'cancelled']);

/**
 * A real card on file = a LunarPay subscription exists
 * (directory_subscription_external_id is set, which only happens once a card is
 * vaulted) or the status genuinely implies a card was processed.
 */
export function hasCardOnFile(v: VenueFunnelState): boolean {
  const status = String(v.directory_subscription_status ?? '').toLowerCase();
  return Boolean(v.directory_subscription_external_id) || CARDED_STATUSES.has(status);
}

/** Optional analytics-event membership sets (by venue id) for the in-modal micro-steps. */
export interface StageEventSets {
  started?: Set<string>;
  details?: Set<string>;
  cardShown?: Set<string>;
}

export const FUNNEL_STAGES = [
  { key: 'signed_up', label: 'Signed up' },
  { key: 'started', label: 'Started onboarding' },
  { key: 'details', label: 'Wrote their guide' },
  { key: 'activated', label: 'Sent a test inquiry' },
  { key: 'card_shown', label: 'Saw the card step' },
  { key: 'card_entered', label: 'Added a card (went live)' },
  { key: 'paid', label: 'Converted to paid' },
] as const;

export type FunnelStageKey = (typeof FUNNEL_STAGES)[number]['key'];

/**
 * For each stage key, whether the venue has REACHED (at least) that stage.
 * Pass analytics-event sets to mirror the aggregate funnel exactly; omit them
 * (e.g. for a single venue card) to decide purely from venue-row state.
 */
export function venueStageReached(
  v: VenueFunnelState,
  ev?: StageEventSets,
): Record<FunnelStageKey, boolean> {
  const id = v.id ? String(v.id) : '';
  const status = String(v.directory_subscription_status ?? '').toLowerCase();
  const step = typeof v.onboarding_last_step === 'number' ? v.onboarding_last_step : null;
  const card = hasCardOnFile(v);
  const startedEv = ev?.started?.has(id) ?? false;
  const detailsEv = ev?.details?.has(id) ?? false;
  const cardShownEv = ev?.cardShown?.has(id) ?? false;

  return {
    signed_up: true,
    started:
      startedEv || step !== null || Boolean(v.is_published) || Boolean(v.onboarding_completed_at),
    details: detailsEv || (step !== null && step >= 1) || Boolean(v.is_published) || card,
    activated: Boolean(v.onboarding_activated_at),
    card_shown: cardShownEv || card,
    card_entered: card,
    paid: status === 'active',
  };
}

/** The furthest stage a single venue has reached (row-state based by default). */
export function furthestStage(
  v: VenueFunnelState,
  ev?: StageEventSets,
): { key: FunnelStageKey; label: string; index: number } {
  const reached = venueStageReached(v, ev);
  let best: { key: FunnelStageKey; label: string; index: number } = {
    key: FUNNEL_STAGES[0].key,
    label: FUNNEL_STAGES[0].label,
    index: 0,
  };
  FUNNEL_STAGES.forEach((s, i) => {
    if (reached[s.key]) best = { key: s.key, label: s.label, index: i };
  });
  return best;
}
