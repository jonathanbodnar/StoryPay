/**
 * GET /api/lunarpay/active
 *
 * Lightweight check: is this venue's payment processing approved?
 * Returns { active: boolean, status: string } from the DB only (no outbound call).
 * Used by sidebar and page guards so it's cheap to call frequently.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';
import { isStoryPayPaused } from '@/lib/storypay-pause';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ active: false, status: 'unauthorized', paused: false });

  const { data } = await supabaseAdmin
    .from('venues')
    .select('onboarding_status, lunarpay_merchant_id, slug')
    .eq('id', venueId)
    .maybeSingle();

  const row = data as { onboarding_status?: string | null; slug?: string | null } | null;
  const status = row?.onboarding_status ?? null;
  const active = status === 'active';

  return NextResponse.json({
    active,
    status: status ?? (active ? 'active' : 'not_started'),
    // Signup is paused for this venue (exempt venues keep full access).
    paused: isStoryPayPaused(row?.slug),
  });
}
