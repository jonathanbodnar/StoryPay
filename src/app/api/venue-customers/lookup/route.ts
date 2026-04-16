import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';

// POST body lookup to avoid URL-encoding issues with email addresses containing '@'
export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { email } = await request.json();
  if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from('venue_customers')
    .select('*, venue_spaces(id, name, color)')
    .eq('venue_id', venueId)
    .eq('customer_email', email.toLowerCase())
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? null);
}
