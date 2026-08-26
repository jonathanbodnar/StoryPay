// Shared between the ingestion endpoint (src/app/api/listing-track) and the
// realtime read endpoint (src/app/api/listing-analytics/realtime) so a
// visitor's broadcasted "ping" (instant) and their next polled row (30s
// later) render with identical labels/flags — no visible mismatch/flicker
// when the poll catches up and supersedes the optimistic point.

export const EVENT_LABELS: Record<string, string> = {
  page_view:            'Viewing listing',
  scroll_25:            'Reading (25%)',
  scroll_50:            'Reading (50%)',
  scroll_75:            'Reading (75%)',
  scroll_100:           'Finished reading',
  photo_view:           'Browsing photos',
  faq_open:             'Reading FAQs',
  map_click:            'Checked location',
  social_click:         'Clicked social link',
  contact_form_open:    'Opened contact form',
  contact_form_submit:  'Sent inquiry ✉️',
  listing_impression:   'Found in search',
  session_heartbeat:    'Browsing listing',
};

/** Country code (e.g. "US") → flag emoji. */
export function countryFlag(code: string | null): string {
  if (!code || code.length !== 2) return '🌐';
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}
