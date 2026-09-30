import { safeRedirect } from '@/lib/safe-redirect';

/**
 * GET /api/auth/ghl/[locationId] — retired.
 *
 * This used to sign the visitor in as whichever venue owned the GoHighLevel
 * location ID in the URL (and create a venue for an unknown ID). A location ID
 * isn't a secret, so that let anyone take over a venue's account. Old links
 * (including CRM menu links) now land on the normal login page; nothing is
 * signed in or created here.
 *
 * The CRM connection itself is unaffected: OAuth (api/messaging/callback),
 * webhooks, the inbound SMS sync and A2P never used this route.
 */
export function GET() {
  return safeRedirect('/login');
}
