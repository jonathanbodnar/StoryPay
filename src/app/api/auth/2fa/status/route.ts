import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/auth/2fa/status — small read for the profile UI. */
export async function GET() {
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
    // Column might not exist yet (migration 125 not run) — degrade silently
    return NextResponse.json({ enabled: false, backupCodesRemaining: 0 });
  }
  return NextResponse.json({
    enabled:               Boolean(data?.totp_enabled_at),
    enabledAt:             data?.totp_enabled_at ?? null,
    backupCodesRemaining:  Array.isArray(data?.totp_backup_codes)
      ? (data!.totp_backup_codes as string[]).length
      : 0,
  });
}
