import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { email } = await request.json();
  if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from('venue_customers')
    .select('*, venue_spaces:wedding_space_id(id, name, color)')
    .eq('venue_id', venueId)
    .eq('customer_email', String(email).toLowerCase())
    .maybeSingle();

  if (error) {
    // Fall back to a plain select in case the FK join isn't present on this project.
    const { data: plain, error: plainErr } = await supabaseAdmin
      .from('venue_customers')
      .select('*')
      .eq('venue_id', venueId)
      .eq('customer_email', String(email).toLowerCase())
      .maybeSingle();
    if (plainErr) {
      console.error('[venue-customers/lookup]', plainErr);
      return NextResponse.json({ error: plainErr.message }, { status: 500 });
    }
    return NextResponse.json(plain ?? null);
  }

  return NextResponse.json(data ?? null);
}
