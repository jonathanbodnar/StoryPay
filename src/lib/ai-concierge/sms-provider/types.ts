/**
 * SMS provider interface for the AI Concierge feature.
 *
 * Per-venue SMS routing is determined by `venues.sms_provider` (default
 * `'ghl'`). Future providers (e.g. a different A2P-verified vendor for new
 * venues) implement this same interface and register themselves in the
 * factory at `./index.ts`.
 *
 * The AI engine never imports a specific provider directly — it always goes
 * through `getSmsProviderForVenue(venueId)` so swapping a venue's provider
 * is a one-row update with zero code changes.
 */

export interface SmsSendInput {
  /** Venue UUID. The provider uses this to load auth credentials. */
  venueId: string;
  /** Lead UUID. The provider uses this to look up the contact's phone. */
  leadId: string;
  /** Final SMS body, already validated for length / content by the caller. */
  message: string;
}

/**
 * Outcome enum — granular enough that the send cron can decide whether to
 * retry, mark the contact unsendable, or surface the error to the venue.
 */
export type SmsSendOutcome =
  | 'sent'              // provider accepted the message and returned an id
  | 'invalid_phone'     // contact has no usable phone number
  | 'dnd'               // contact has provider-side DND set
  | 'auth_error'        // venue is missing tokens / not connected to provider
  | 'transient_error'   // network / 5xx — caller may retry on the next tick
  | 'permanent_error';  // 4xx / unprocessable — caller should NOT retry

export interface SmsSendResult {
  ok: boolean;
  outcome: SmsSendOutcome;
  /** Provider-assigned message id when send succeeded. */
  providerMessageId?: string;
  /** Human-readable error string for logging. */
  error?: string;
}

export interface SmsProvider {
  /** Stable identifier matching `venues.sms_provider`. */
  readonly key: string;
  /** Display label for logs and the super-admin live runs monitor. */
  readonly label: string;
  send(input: SmsSendInput): Promise<SmsSendResult>;
}
