import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import bcrypt from 'bcryptjs';
import { verifyTotp, generateBackupCodes } from '@/lib/totp';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/auth/2fa/enable
 * body: { code: string }
 *
 * Confirms the user has scanned the QR code by checking a TOTP they just
 * read off their authenticator app. On success:
 *  1. Sets `totp_enabled_at = now()` (the row was already holding the
 *     pending secret from /setup).
 *  2. Generates 10 single-use backup codes, stores bcrypt hashes, and
 *     returns the plaintext codes ONCE — the client must show them and
 *     warn the user to save them.
 */
export async function POST(req: NextRequest) {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  const memberId = c.get('member_id')?.value;
  if (!venueId || memberId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { code } = await req.json() as { code?: string };
  if (!code) return NextResponse.json({ error: 'Code is required.' }, { status: 400 });

  const { data: venue, error } = await supabaseAdmin
    .from('venues')
    .select('id, totp_secret, totp_enabled_at')
    .eq('id', venueId)
    .maybeSingle();
  if (error || !venue) {
    return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  }
  if (venue.totp_enabled_at) {
    return NextResponse.json({ error: '2FA is already enabled.' }, { status: 409 });
  }
  if (!venue.totp_secret) {
    return NextResponse.json(
      { error: 'No 2FA enrolment in progress. Start setup first.' },
      { status: 400 },
    );
  }

  if (!verifyTotp(venue.totp_secret as string, code)) {
    return NextResponse.json({ error: 'Code is incorrect or expired.' }, { status: 400 });
  }

  const backupCodes = generateBackupCodes(10);
  const hashed = await Promise.all(backupCodes.map((b) => bcrypt.hash(b, 10)));

  const { error: updErr } = await supabaseAdmin
    .from('venues')
    .update({
      totp_enabled_at:   new Date().toISOString(),
      totp_backup_codes: hashed,
    })
    .eq('id', venueId);
  if (updErr) {
    console.error('[2fa enable] update error:', updErr.message);
    return NextResponse.json({ error: 'Could not enable 2FA.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, backupCodes });
}
