import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { ghlRequest } from '@/lib/ghl';

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;

  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('ghl_connected, ghl_access_token, ghl_location_id')
    .eq('id', venueId)
    .single();

  if (!venue?.ghl_connected || !venue.ghl_access_token || !venue.ghl_location_id) {
    return NextResponse.json({ error: 'Messaging not connected' }, { status: 400 });
  }

  const search = request.nextUrl.searchParams.get('search') || '';
  const limit = request.nextUrl.searchParams.get('limit') || '15';

  try {
    const result = await ghlRequest(
      `/contacts/?locationId=${venue.ghl_location_id}&query=${encodeURIComponent(search)}&limit=${limit}`,
      venue.ghl_access_token,
      { locationId: venue.ghl_location_id }
    );

    const contacts = (result.contacts || []).map((c: Record<string, unknown>) => ({
      id: c.id,
      firstName: c.firstName || '',
      lastName: c.lastName || '',
      name: [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || 'Unknown',
      email: c.email || '',
      phone: c.phone || '',
    }));

    return NextResponse.json(contacts);
  } catch (err) {
    console.error('[contacts] GHL search error:', err);
    return NextResponse.json({ error: 'Failed to search contacts' }, { status: 500 });
  }
}
