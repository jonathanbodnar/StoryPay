import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { TWOFA_ENABLED } from '@/lib/feature-flags';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/auth/2fa/status
 *
 * Always reachable so the profile UI can decide whether to render the 2FA
 * section. Returns:
 *   - available: false when the feature flag is off (UI hides the section)
 *   - enabled:   true when the user has finished enrolment
 */
export async function GET() {
  if (!TWOFA_ENABLED) {
    return NextResponse.json({ available: false, enabled: false, backupCodesRemaining: 0 });
  }

  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  const memberId = c.get('member_id')?.value;
  if (!venueId || memberId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from('venues')
    .select('totp_enabled_at, totp_backup_codes')
    .eq('id', venueId)
    .maybeSingle();
  if (error) {
    // Column might not exist yet (migration 125 not run) — degrade silently.
    return NextResponse.json({ available: true, enabled: false, backupCodesRemaining: 0 });
  }
  return NextResponse.json({
    available:             true,
    enabled:               Boolean(data?.totp_enabled_at),
    enabledAt:             data?.totp_enabled_at ?? null,
    backupCodesRemaining:  Array.isArray(data?.totp_backup_codes)
      ? (data!.totp_backup_codes as string[]).length
      : 0,
  });
}
