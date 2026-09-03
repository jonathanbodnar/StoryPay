import { NextResponse } from 'next/server';
import { setSignedCookie } from '@/lib/venue-session';

/**
 * Shared post-authentication logic used by both the password sign-in path
 * and the 2FA verify path. Sets the venue_id cookie and sends the venue to
 * the dashboard.
 *
 * Venues always land on /dashboard. Plan selection and card capture are
 * handled by the OnboardingWizard, which hard-gates any venue that hasn't
 * gone live yet — so there is no separate pre-dashboard plan gate.
 */
export async function buildVenueAuthSuccessResponse(opts: {
  venueId:    string;
  rememberMe: boolean;
  /** True when the sign-in originated from the Capacitor native app shell —
   *  grants the 90-day idle session instead of the web 8h/7d policy. */
  isNative?:  boolean;
}): Promise<NextResponse> {
  const maxAge = opts.rememberMe ? 60 * 60 * 24 * 365 : 60 * 60 * 24 * 30;

  const response = NextResponse.json({ redirect: '/dashboard' });
  setSignedCookie(response, 'venue_id', opts.venueId, {
    path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge,
  }, { rememberMe: opts.rememberMe, isNative: opts.isNative });
  return response;
}
