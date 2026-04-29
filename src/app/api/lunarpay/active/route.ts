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

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ active: false, status: 'unauthorized' });

  const { data } = await supabaseAdmin
    .from('venues')
    .select('onboarding_status, lunarpay_sk')
    .eq('id', venueId)
    .maybeSingle();

  const status = (data as { onboarding_status?: string | null } | null)?.onboarding_status ?? null;
  const hasSk  = !!(data as { lunarpay_sk?: string | null } | null)?.lunarpay_sk;
  const active = status === 'active' && hasSk;

  return NextResponse.json({ active, status: status ?? 'not_registered' });
}
