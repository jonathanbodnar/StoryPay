/**
 * Shared Gmail-style email formatting helpers.
 *
 * These are the same utilities used by the Venue Concierge thread — re-exported
 * under a neutral path so the Support Inbox (bride replies, Venue Direct, and
 * support tickets) can format inbound/outbound emails identically: unwrap
 * `<https://…>` / `<name@email>` angle brackets, strip `*emphasis*`, drop
 * `[image: …]` placeholders, and split the body into reply / signature / quoted
 * parts so the quoted trail can render as a clean nested blockquote.
 */

export {
  tidyEmailText,
  parseQuoted,
  parseConciergeMessage as parseEmailParts,
} from '@/lib/venue-concierge/message-format';

export type {
  QuoteGroup,
  ParsedConciergeMessage as ParsedEmail,
} from '@/lib/venue-concierge/message-format';
