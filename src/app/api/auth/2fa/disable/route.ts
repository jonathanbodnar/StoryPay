import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import bcrypt from 'bcryptjs';
import { verifyTotp, normalizeBackupCode } from '@/lib/totp';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/auth/2fa/disable
 * body: { password: string, code: string }
 *
 * Disabling 2FA is a privileged operation. We require BOTH:
 *  - the venue's current password (proof the session isn't a stolen cookie)
 *  - either a current TOTP code OR a backup code (proof of physical
 *    possession of the second factor)
 *
 * Both columns are cleared on success so a future enrolment starts fresh.
 */
export async function POST(req: NextRequest) {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  const memberId = c.get('member_id')?.value;
  if (!venueId || memberId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { password, code } = await req.json() as { password?: string; code?: string };
  if (!password) return NextResponse.json({ error: 'Password is required.' }, { status: 400 });
  if (!code)     return NextResponse.json({ error: 'Code is required.' },     { status: 400 });

  const { data: venue, error } = await supabaseAdmin
    .from('venues')
    .select('id, password_hash, totp_secret, totp_enabled_at, totp_backup_codes')
    .eq('id', venueId)
    .maybeSingle();
  if (error || !venue) {
    return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  }
  if (!venue.totp_enabled_at) {
    return NextResponse.json({ error: '2FA is not enabled.' }, { status: 409 });
  }

  const pwOk = venue.password_hash
    ? await bcrypt.compare(password, venue.password_hash as string)
    : false;
  if (!pwOk) {
    return NextResponse.json({ error: 'Password is incorrect.' }, { status: 401 });
  }

  // Accept either a TOTP or a backup code so a user can recover even if
  // they've lost their authenticator app.
  const totpOk = verifyTotp(venue.totp_secret as string, code);
  const trimmedCode = normalizeBackupCode(code);
  let backupOk = false;
  if (!totpOk && Array.isArray(venue.totp_backup_codes)) {
    for (const hash of venue.totp_backup_codes as string[]) {
      if (await bcrypt.compare(trimmedCode, hash)) { backupOk = true; break; }
    }
  }
  if (!totpOk && !backupOk) {
    return NextResponse.json({ error: 'Code is incorrect or expired.' }, { status: 400 });
  }

  const { error: updErr } = await supabaseAdmin
    .from('venues')
    .update({
      totp_secret:       null,
      totp_enabled_at:   null,
      totp_backup_codes: null,
    })
    .eq('id', venueId);
  if (updErr) {
    console.error('[2fa disable] update error:', updErr.message);
    return NextResponse.json({ error: 'Could not disable 2FA.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
