import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { generateTotpSecret, buildOtpAuthUri } from '@/lib/totp';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/auth/2fa/setup
 *
 * Initialises a 2FA enrolment for the signed-in venue owner.
 *
 * Behaviour:
 *  - Generates a fresh TOTP secret and stores it on the venue row WITHOUT
 *    setting `totp_enabled_at` — enrolment is only "live" once the user
 *    posts a valid code to /api/auth/2fa/enable.
 *  - Re-running setup overwrites any half-finished secret. This is fine:
 *    the previous secret was never confirmed, so it was inert.
 *  - Returns the otpauth:// URI so the client can render a QR code, plus
 *    the raw secret for manual entry.
 *
 * If the venue already has 2FA enabled, this endpoint refuses — the user
 * must disable 2FA first (which requires their current TOTP).
 */
export async function POST() {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  // Only the owner — not a team member impersonating via member_id — can
  // touch 2FA. The owner cookie is `venue_id` without `member_id`.
  const memberId = c.get('member_id')?.value;
  if (!venueId || memberId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: venue, error } = await supabaseAdmin
    .from('venues')
    .select('id, email, totp_enabled_at')
    .eq('id', venueId)
    .maybeSingle();
  if (error || !venue) {
    return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  }
  if (venue.totp_enabled_at) {
    return NextResponse.json(
      { error: '2FA is already enabled. Disable it first to re-enrol.' },
      { status: 409 },
    );
  }

  const secret = generateTotpSecret();
  const { error: updErr } = await supabaseAdmin
    .from('venues')
    .update({ totp_secret: secret })
    .eq('id', venueId);
  if (updErr) {
    console.error('[2fa setup] update error:', updErr.message);
    return NextResponse.json({ error: 'Could not start enrolment.' }, { status: 500 });
  }

  const otpauthUri = buildOtpAuthUri({
    secret,
    accountName: (venue.email as string | null) ?? 'venue',
    issuer:      'StoryVenue',
  });

  return NextResponse.json({ secret, otpauthUri });
}
