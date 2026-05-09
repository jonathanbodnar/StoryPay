import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { consumeVerificationToken } from '@/lib/email-verification';
import { provisionVenueLunarPayMerchant } from '@/lib/venue-lunarpay-onboard';
import { safeRedirect } from '@/lib/safe-redirect';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/auth/verify-email/<token>
 *
 * Redeems a one-time email-verification token. On success:
 *  1. Marks venues.email_verified_at = now() (and clears the token).
 *  2. Triggers the idempotent LunarPay sub-merchant provisioning.
 *  3. Sets the venue session cookie so the user lands signed in on the
 *     /verify-email/success page (or the dashboard).
 *  4. Redirects to /verify-email/success.
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

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id, email, owner_first_name, owner_last_name, name, phone, lunarpay_merchant_id')
    .eq('id', result.venueId)
    .maybeSingle();

  if (venue && !venue.lunarpay_merchant_id) {
    // Best-effort: do not block the redirect on LunarPay outages. If
    // provisioning fails here, the user can retry from
    // /api/lunarpay/register (the existing manual application form).
    void provisionVenueLunarPayMerchant({
      venueId:      venue.id as string,
      email:        (venue.email as string | null) ?? '',
      firstName:    (venue.owner_first_name as string | null) ?? '',
      lastName:     (venue.owner_last_name as string | null) ?? '',
      phone:        (venue.phone as string | null) ?? null,
      businessName: (venue.name as string | null) ?? 'Venue',
    });
  }

  const response = safeRedirect('/verify-email/success');
  response.cookies.set('venue_id', result.venueId, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
