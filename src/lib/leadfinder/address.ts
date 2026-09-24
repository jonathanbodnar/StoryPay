/**
 * StoryVenue LeadFinder™ — the per-venue inbound address.
 *
 * Mirrors the signed-address scheme in conversations-inbound-email.ts, for the
 * same reason: the local part carries the venue id plus an HMAC of it, so an
 * inbound message can be attributed to a venue WITHOUT trusting the From header,
 * which any sender can forge.
 *
 * Address shape:
 *
 *   leadfinder+{venueId}+{sig16}@{CONVERSATIONS_INBOUND_DOMAIN}
 *
 * The signature is purpose-separated (`lf|{venueId}`) exactly like the existing
 * `vc|{venueId}` concierge signature, so a LeadFinder signature can never be
 * replayed as a conversation reply signature or vice versa.
 *
 * One address per venue serves BOTH onboarding paths — pasting it into a
 * marketplace's notification field, or forwarding mail to it with a filter rule.
 * Nothing downstream needs to know which was used.
 */

import { createHmac, timingSafeEqual } from 'crypto';

/** Domain the address is built on. Shares the conversations inbound domain. */
function inboundDomain(): string | null {
  return process.env.CONVERSATIONS_INBOUND_DOMAIN?.trim() || null;
}

function inboundSecret(): string | null {
  return process.env.CONVERSATIONS_INBOUND_SECRET?.trim() || null;
}

/**
 * Master switch. LeadFinder is NEW INGEST PATHS (inbound email becoming leads),
 * so it fails closed: off unless explicitly enabled, and even then optionally
 * limited to a list of venue slugs so it can be trialled on one account.
 *
 *   LEADFINDER_ENABLED=true        → on for every venue
 *   LEADFINDER_VENUE_SLUGS=a,b     → on for these venues regardless of the above
 */
export function leadFinderEnabledForSlug(slug: string | null | undefined): boolean {
  if (process.env.LEADFINDER_ENABLED === 'true') return true;
  if (!slug) return false;
  const allow = (process.env.LEADFINDER_VENUE_SLUGS ?? 'demo-venue')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return allow.includes(slug.toLowerCase());
}

/** HMAC hex (16 chars) over the venue id, namespaced to LeadFinder. */
export function leadFinderSignature(venueId: string, secret: string): string {
  return createHmac('sha256', secret).update(`lf|${venueId}`).digest('hex').slice(0, 16);
}

/**
 * The address to hand a venue. Null when the inbound domain or secret is not
 * configured, so the UI can explain the integration is unavailable rather than
 * showing a broken address.
 */
export function buildLeadFinderAddress(venueId: string): string | null {
  const secret = inboundSecret();
  const domain = inboundDomain();
  if (!secret || !domain || !venueId) return null;
  return `leadfinder+${venueId}+${leadFinderSignature(venueId, secret)}@${domain}`;
}

const UUID_RE = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const SIG_RE = /^[a-f0-9]{16}$/i;

/** Parse a `leadfinder+{venueId}+{sig}` local part, or null if it is not one. */
export function parseLeadFinderLocalPart(
  localPart: string,
): { venueId: string; sig: string } | null {
  const parts = localPart.split('+');
  if (parts.length !== 3 || parts[0].toLowerCase() !== 'leadfinder') return null;
  const venueId = parts[1];
  const sig = parts[2];
  if (!UUID_RE.test(venueId)) return null;
  if (!SIG_RE.test(sig)) return null;
  return { venueId, sig: sig.toLowerCase() };
}

/** Constant-time verify. False when the secret is missing, never throws. */
export function verifyLeadFinderSignature(venueId: string, sig: string): boolean {
  const secret = inboundSecret();
  if (!secret) return false;
  const expected = leadFinderSignature(venueId, secret);
  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(sig.toLowerCase(), 'hex');
    if (a.length !== b.length || a.length === 0) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
