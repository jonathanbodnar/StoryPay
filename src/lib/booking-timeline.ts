/**
 * Directory listing form "When do you plan to start touring?" options.
 *
 * The values MUST match the directory site's BOOKING_TIMELINES slugs
 * (weddingdirectory/src/lib/constants.ts) — the directory form submits these
 * slugs to /api/public/leads, so the dashboard has to speak the same language
 * or a lead's selected timeline renders blank in the profile / leads views.
 */
export const BOOKING_TIMELINE_OPTIONS: { value: string; label: string }[] = [
  { value: 'ready_now', label: "I'm ready to schedule tours now" },
  { value: 'next_few_weeks', label: 'Within the next few weeks' },
  { value: 'researching', label: 'Just researching' },
];

const LABEL_BY_VALUE = new Map(BOOKING_TIMELINE_OPTIONS.map((o) => [o.value, o.label]));

/** Human label for a stored timeline value; falls back to the raw value. */
export function bookingTimelineLabel(value: string | null | undefined): string {
  if (!value) return '';
  return LABEL_BY_VALUE.get(value) ?? value;
}

/**
 * Options for a <select>, guaranteeing the currently-stored value is always
 * present. Legacy or free-text values (e.g. imported leads, older taxonomies)
 * are injected as their own option so an existing answer never silently
 * disappears from the dropdown.
 */
export function bookingTimelineOptions(
  current: string | null | undefined,
): { value: string; label: string }[] {
  if (current && !LABEL_BY_VALUE.has(current)) {
    return [{ value: current, label: current }, ...BOOKING_TIMELINE_OPTIONS];
  }
  return BOOKING_TIMELINE_OPTIONS;
}
