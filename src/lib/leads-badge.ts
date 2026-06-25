/**
 * Shared localStorage key for the "new leads" inbox badge baseline. Both the
 * desktop sidebar and the mobile tab bar read/write this so opening the Lead
 * Inbox in one place clears the badge everywhere.
 */
export const LEADS_SEEN_KEY = 'sv_leads_seen_at';
