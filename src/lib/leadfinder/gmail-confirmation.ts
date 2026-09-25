/**
 * StoryVenue LeadFinder™ — Gmail's forwarding confirmation.
 *
 * The Gmail onboarding path ("add the address under Forwarding, confirm, then a
 * filter") starts with Gmail sending a confirmation email TO the LeadFinder
 * address. It contains a code the venue must type back into Gmail. Treated as an
 * ordinary arrival it would either become a junk lead or be skipped out of
 * sight — and the venue would be stuck at step one with no way to see the code.
 *
 * So it is recognised and surfaced instead: the arrival is recorded (never a
 * lead), the venue's inbox copy leads with the code, and the Settings card shows
 * it until real mail starts flowing.
 *
 * We deliberately do NOT follow the confirmation link ourselves. Confirming a
 * forward changes the venue's Gmail settings; that stays the venue's click.
 *
 * Pure: reads strings, returns a small object.
 */

export interface GmailForwardingConfirmation {
  /** The numeric code Gmail asks the account owner to enter. */
  code: string | null;
  /** Gmail's own confirmation link (only ever a google.com URL). */
  confirmUrl: string | null;
  /** The Gmail address that asked to forward to us. */
  requestedBy: string | null;
}

const GMAIL_FORWARDING_SENDER = /^forwarding-noreply@google\.com$/i;

export function parseGmailForwardingConfirmation(input: {
  senderEmail: string | null | undefined;
  subject: string | null | undefined;
  text: string | null | undefined;
}): GmailForwardingConfirmation | null {
  const sender = (input.senderEmail ?? '').trim().toLowerCase();
  const subject = input.subject ?? '';
  const text = input.text ?? '';

  // Both signals are required: anyone can write the subject line, but only
  // Google sends from this address, and the subject pins down which Google mail.
  if (!GMAIL_FORWARDING_SENDER.test(sender)) return null;
  if (!/forwarding confirmation/i.test(subject)) return null;

  const code =
    /confirmation code\s*:\s*(\d{6,12})/i.exec(text)?.[1] ??
    /\(#\s*(\d{6,12})\s*\)/.exec(subject)?.[1] ??
    null;

  // Only a google.com link is ever surfaced, so nothing else in the body can
  // masquerade as "the link to click".
  const urlMatch = /https:\/\/(?:mail-settings|mail|isolated\.mail)\.google\.com\/[^\s<>()"']+/i.exec(text);
  const confirmUrl = urlMatch ? urlMatch[0].replace(/[.,;]+$/, '') : null;

  const requestedBy =
    /receive mail from\s+([^\s]+@[^\s]+)/i.exec(subject)?.[1]?.toLowerCase() ??
    /([a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,})\s+has requested to automatically forward/i.exec(text)?.[1]?.toLowerCase() ??
    null;

  return { code, confirmUrl, requestedBy };
}
