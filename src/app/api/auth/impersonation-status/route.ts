import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Whether the current browser session is admin impersonation (venue view). */
export async function GET() {
  const c = await cookies();
  const flag = c.get('admin_impersonating')?.value === '1';
  const venueId = c.get('venue_id')?.value;

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
