/**
 * Leaf module (no imports) defining which system tags are visible to venue
 * owners and which are inert. Kept dependency-free so both `system-tags.ts`
 * and `marketing-email-worker.ts` can import it without creating a module
 * cycle (system-tags ↔ marketing-email-worker).
 */

/**
 * The ONLY system tags a venue owner should ever see in the SaaS UI (tag
 * pickers, contact profiles, Kanban cards, the tag manager, campaign audience
 * pickers, etc.). These are informational, human-applied labels.
 *
 * IMPORTANT: tags in this set are INERT — applying one never enrolls a lead in
 * an automation and never dispatches a `tag.added` integration event. They are
 * purely for the venue owner's own reference.
 *
 * Every other system tag is a BACKGROUND tag: it still auto-applies on real
 * events and still fires automation triggers, but it is hidden from the venue
 * owner UI so the tag library stays clean and simple.
 */
export const VISIBLE_SYSTEM_TAG_KEYS = new Set<string>([
  'hot_lead',
  'cold_lead',
  'vip',
  'do_not_contact',
  'follow_up_needed',
  'tour_no_show',
  'qualified',
  'unqualified',
]);

/** True when this system tag should be shown to the venue owner in the UI. */
export function isSystemTagVisible(systemKey: string | null | undefined): boolean {
  return !!systemKey && VISIBLE_SYSTEM_TAG_KEYS.has(systemKey);
}

/**
 * True when applying this system tag must NOT fire any automation or
 * integration side-effects. All venue-visible system tags are inert.
 */
export function isSystemTagInert(systemKey: string | null | undefined): boolean {
  return isSystemTagVisible(systemKey);
}
