/**
 * "Act as venue" — let an authenticated super admin or support agent perform
 * a venue-scoped action on behalf of a venue, without flipping any session
 * cookies. Useful when support needs to create a calendar event, look up
 * spaces, etc. for a venue from inside the support inbox.
 *
 * Wire-up:
 *   • Client sends `X-Acting-As-Venue: <venueId>` on the request.
 *   • Server resolves the effective venue id with `getEffectiveVenueId(req)`.
 *   • If the header is set AND the caller has a valid super-admin or support
 *     session, the header value wins. Otherwise we fall back to the regular
 *     `venue_id` cookie (i.e. the venue user's own session).
 *
 * This means *every* venue-scoped endpoint that opts in just swaps:
 *   const venueId = await getVenueId();
 *   →
 *   const venueId = await getEffectiveVenueId(request);
 * …and gains super-admin act-as support for free, with zero changes to the
 * cookie/session layer.
 */
import type { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { verifySupportAccess } from '@/lib/support/auth';

const HEADER = 'x-acting-as-venue';

/** Plain cookie-based venue id — the original behavior. */
async function venueIdFromCookie(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

/** True if the caller has a super-admin token or a valid support session. */
async function hasAdminAuthority(): Promise<boolean> {
  const auth = await verifySupportAccess();
  return auth.isSuperAdmin || !!auth.agent;
}

/**
 * Resolve the venue id this request should operate against.
 *
 * Pass the `NextRequest` so we can read the optional override header. If you
 * don't have a request object handy (e.g. a page server component), call
 * `getEffectiveVenueId()` with no arg — you'll get the same behavior as the
 * old `getVenueId()` (cookie only, no header lookup).
 */
export async function getEffectiveVenueId(req?: NextRequest | Request): Promise<string | null> {
  const override = req?.headers.get(HEADER);
  if (override && await hasAdminAuthority()) {
    return override;
  }
  return venueIdFromCookie();
}

/** Throwing variant — mirrors `requireVenueId`. */
export async function requireEffectiveVenueId(req?: NextRequest | Request): Promise<string> {
  const id = await getEffectiveVenueId(req);
  if (!id) throw new Error('Unauthorized');
  return id;
}

/** True when the current request is acting on behalf of a venue (super admin
 *  side). Useful when an endpoint wants to skip member-name resolution that
 *  only makes sense for actual venue users. */
export async function isActingAsVenue(req?: NextRequest | Request): Promise<boolean> {
  const override = req?.headers.get(HEADER);
  if (!override) return false;
  return hasAdminAuthority();
}

export const ACTING_AS_VENUE_HEADER = HEADER;
