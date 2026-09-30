import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';
import { IMPERSONATION_COOKIE, isAdminImpersonating } from '@/lib/admin-impersonation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Whether the current browser session is admin impersonation (venue view). */
export async function GET() {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  const flag = isAdminImpersonating(c.get(IMPERSONATION_COOKIE)?.value, venueId);

  if (!flag || !venueId) {
    return NextResponse.json({ impersonating: false });
  }

  const { data: venue } = await supabaseAdmin.from('venues').select('name').eq('id', venueId).maybeSingle();
  return NextResponse.json({
    impersonating: true,
    venueId,
    venueName: venue?.name ?? 'Venue',
  });
}
