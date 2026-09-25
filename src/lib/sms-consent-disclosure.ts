/**
 * The exact texting-consent wording couples see, in ONE place.
 *
 * Used by the guide page, the listing / Lead Link modal, the embed form and
 * marketing forms (all client-side), and by the servers that record proof of
 * consent — so what is stored in `sms_consent_records` is always the same text
 * the couple was shown. Pure and client-safe: no imports, no I/O.
 *
 * The wording was chosen with the product owner: the shortest version that
 * names the sender, says texts are automated, covers rates and how to stop, and
 * links the Privacy and Terms sections (which carry frequency and HELP).
 *
 * CHANGING THE WORDING? Bump SMS_CONSENT_VERSION so stored records can always be
 * matched to the text that was actually on screen.
 */

export const SMS_CONSENT_VERSION = '2026-09-25.v1';

/** Where the linked policy sections live (anchors on the StoryVenue pages). */
export const SMS_CONSENT_PRIVACY_PATH = '/privacy#text-messaging';
export const SMS_CONSENT_TERMS_PATH = '/terms#text-messaging';

function venueLabel(venueName: string | null | undefined): string {
  return (venueName ?? '').trim() || 'this venue';
}

/** Under the "Send my guide" button on the gated guide page. */
export function guidePageConsentText(venueName: string | null | undefined): string {
  return `By tapping Send my guide, you agree to automated texts from ${venueLabel(venueName)} at this number. Msg & data rates may apply. Reply STOP to opt out.`;
}

/** Under the submit button of any lead form that asks for a phone number. */
export function formConsentText(venueName: string | null | undefined): string {
  return `By submitting this form, you agree to automated texts from ${venueLabel(venueName)} at the number provided. Msg & data rates may apply. Reply STOP to opt out.`;
}

/** The full line as shown, links included — what a consent record stores. */
export function withPolicyLinks(sentence: string): string {
  return `${sentence} Privacy · Terms`;
}
