/**
 * Canonical onboarding checklist for a private-client venue, shown on the admin
 * Projects board card (and stored on the venue itself via
 * venues.project_checklist so the same completion state can surface anywhere in
 * the SaaS). The order here is the display order.
 *
 * Keys are stable identifiers — never rename a key once shipped (it's what the
 * stored JSONB map is keyed by). Change the label freely; add new items at the
 * end. Stored shape: { [key]: boolean } (missing/false = not done).
 */
export interface ProjectChecklistItem {
  key: string;
  label: string;
}

export const PROJECT_CHECKLIST_ITEMS: ProjectChecklistItem[] = [
  { key: 'created_listing',     label: 'Created listing on StoryVenue' },
  { key: 'added_cc',            label: 'Added CC details' },
  { key: 'added_to_meta',       label: 'Added to Meta' },
  { key: 'training_scheduled',  label: 'Training Scheduled' },
  { key: 'review_call_setup',   label: '30 Day Review Call Setup' },
  { key: 'a2p_submitted',       label: 'A2P Submitted' },
  { key: 'a2p_approved',        label: 'A2P Approved' },
  { key: 'a2p_connected',       label: 'A2P Connected to Account' },
  { key: 'training_completed',  label: 'Training Completed' },
  { key: 'stripe_subscription', label: 'Stripe Subscription Created' },
  { key: 'ads_created',         label: 'Ads Created' },
  { key: 'qa_account',          label: 'QA Account' },
  { key: 'ads_published',       label: 'Ads Published' },
  { key: 'account_live',        label: 'Account Live' },
];

export const PROJECT_CHECKLIST_KEYS = new Set(PROJECT_CHECKLIST_ITEMS.map((i) => i.key));

export type ProjectChecklistState = Record<string, boolean>;

/** Coerce arbitrary stored JSON into a clean { key: boolean } map (known keys only). */
export function normalizeChecklist(raw: unknown): ProjectChecklistState {
  const out: ProjectChecklistState = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!PROJECT_CHECKLIST_KEYS.has(k)) continue;
      // Tolerant of legacy shapes ({done:bool} or timestamp) — truthy = done.
      out[k] = v === true || (typeof v === 'object' && v !== null && (v as { done?: unknown }).done === true) || (typeof v === 'string' && v.length > 0);
    }
  }
  return out;
}
