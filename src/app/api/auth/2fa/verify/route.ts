import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyTotp, normalizeBackupCode } from '@/lib/totp';
import {
  TWO_FA_PENDING_COOKIE,
  verifyPendingToken,
} from '@/lib/twofa-pending';
import { buildVenueAuthSuccessResponse } from '@/lib/auth-success';
import { rateLimit, getClientIp, formatRetryAfter } from '@/lib/rate-limit';
import { TWOFA_ENABLED } from '@/lib/feature-flags';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/auth/2fa/verify
 * body: { code: string }
 *
 * Consumes the `2fa_pending` cookie issued by the password sign-in flow.
 * On success, sets the real `venue_id` cookie and clears the pending one.
 *
 * Rate-limited per-IP (15/5min) so an attacker who steals a pending token
 * still can't brute-force the 6-digit code.
 *
 * If the code matches a stored backup code, that backup code is consumed
 * (removed from the array) — they're single-use by design.
 */
export async function POST(req: NextRequest) {
  if (!TWOFA_ENABLED) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const ip = getClientIp(req);
  const rl = rateLimit(`2fa-verify:ip:${ip}`, 15, 5 * 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${formatRetryAfter(rl.retryAfterMs)}.` },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  const c = await cookies();
  const pending = verifyPendingToken(c.get(TWO_FA_PENDING_COOKIE)?.value);
  if (!pending) {
    return NextResponse.json(
      { error: 'Your sign-in session has expired. Please sign in again.' },
      { status: 401 },
    );
  }

  const { code } = await req.json() as { code?: string };
  if (!code) return NextResponse.json({ error: 'Code is required.' }, { status: 400 });

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id, totp_secret, totp_enabled_at, totp_backup_codes, directory_plan_id, directory_subscription_status')
    .eq('id', pending.venueId)
    .maybeSingle();
  if (!venue || !venue.totp_enabled_at) {
    return NextResponse.json({ error: '2FA is not enabled on this account.' }, { status: 400 });
  }

  // Try TOTP first (the common case)
  let valid = verifyTotp(venue.totp_secret as string, code);
  let consumedBackupIndex = -1;

  if (!valid && Array.isArray(venue.totp_backup_codes)) {
    const trimmed = normalizeBackupCode(code);
    const codes = venue.totp_backup_codes as string[];
    for (let i = 0; i < codes.length; i++) {
      if (await bcrypt.compare(trimmed, codes[i])) {
        valid = true;
        consumedBackupIndex = i;
        break;
      }
    }
  }

  if (!valid) {
    return NextResponse.json({ error: 'Code is incorrect or expired.' }, { status: 400 });
  }

  // Burn the backup code so it can't be replayed.
  if (consumedBackupIndex >= 0) {
    const remaining = (venue.totp_backup_codes as string[]).filter(
      (_, i) => i !== consumedBackupIndex,
    );
    await supabaseAdmin
      .from('venues')
      .update({ totp_backup_codes: remaining })
      .eq('id', venue.id);
  }

  const response = await buildVenueAuthSuccessResponse({
    venueId:    venue.id,
    rememberMe: pending.rememberMe,
    prefetched: {
      directory_plan_id:             (venue.directory_plan_id as string | null) ?? null,
      directory_subscription_status: (venue.directory_subscription_status as string | null) ?? null,
    },
  });
  // Clear the pending token now that the real session is set.
  response.cookies.set(TWO_FA_PENDING_COOKIE, '', {
    path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 0,
  });
  return response;
}
