import { NextRequest } from 'next/server';
import { consumeVerificationToken } from '@/lib/email-verification';
import { safeRedirect } from '@/lib/safe-redirect';
import { setSignedCookie } from '@/lib/venue-session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/auth/verify-email/<token>
 *
 * Redeems a one-time email-verification token. On success:
 *  1. Marks venues.email_verified_at = now() (and clears the token).
 *  2. Sets the venue session cookie so the user lands signed in on the
 *     /verify-email/success page (or the dashboard).
 *  3. Redirects to /verify-email/success.
 *
 * It used to create a LunarPay merchant account too. LunarPay is retired
 * (StoryPay™ runs on Stripe; lib/lunarpay-retired.ts), so it no longer does.
 *
 * On failure (unknown / expired / used token), redirects to
 * /verify-email/invalid so the page can offer a "Resend verification" CTA.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const result = await consumeVerificationToken(token);
  if (!result) {
    return safeRedirect('/verify-email/invalid');
  }

  const response = safeRedirect('/verify-email/success');
  setSignedCookie(response, 'venue_id', result.venueId, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
