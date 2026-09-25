/**
 * StoryVenue LeadFinder™ — why an arrival did not become a lead, in words a
 * venue owner understands.
 *
 * One table shared by the inbox copy (mirror), the Settings activity list and
 * anything else that shows a skip or failure reason, so the same event is never
 * described two different ways. Unknown reasons degrade to the raw token with
 * underscores removed rather than being hidden, so a new reason is still legible.
 */

export const LEADFINDER_REASON_LABELS: Record<string, string> = {
  not_an_inquiry_subject: 'it looked like an account notice, a bounce or an auto-reply, not an inquiry',
  no_email_address: 'we could not find an email address for the couple',
  only_venue_email: "the only email address in it is your venue's own (your account, notification or team email), so we couldn't tell it was a couple — it needs the couple's own email",
  bounce_or_system_message: 'it was an automated system message',
  auto_reply: 'it was an automatic reply',
  leadfinder_disabled_for_venue: 'LeadFinder is not switched on for your account yet',
  extract_threw: 'we could not read the message',
  lead_insert_failed: 'we could not save the lead',
  import_row_failed: 'we could not record the message',
  rejected: 'it did not look like a wedding inquiry',
  own_message_loop: 'it was one of our own emails coming back (a forwarding loop), so we stopped it',
  rate_limited: 'too many messages arrived in the last hour, so we paused to protect your inbox',
  gmail_forwarding_confirmation: 'this is Gmail asking you to confirm forwarding',
  processing_interrupted: 'processing was interrupted; it will be retried',
  test_inquiry: 'it was a test you sent from Settings — a test never becomes a lead',
};

export function leadFinderReasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  if (LEADFINDER_REASON_LABELS[reason]) return LEADFINDER_REASON_LABELS[reason];
  // A raw database error stored as a failure detail is not for a venue owner.
  if (reason.length > 60 || /[{}"]|violates|constraint|column|relation/i.test(reason)) {
    return 'something went wrong on our side';
  }
  return reason.replace(/_/g, ' ');
}
