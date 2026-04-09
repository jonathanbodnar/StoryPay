import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { ghlRequest, refreshAccessToken } from '@/lib/ghl';
import { listCustomers } from '@/lib/lunarpay';

interface NormalizedContact {
  id: string;
  source: 'ghl' | 'lunarpay';
  firstName: string;
  lastName: string;
  name: string;
  email: string;
  phone: string;
}

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;

  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('ghl_connected, ghl_access_token, ghl_refresh_token, ghl_location_id, lunarpay_secret_key')
    .eq('id', venueId)
    .single();

  if (!venue) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

  // Auto-refresh GHL token
  let ghlToken = venue.ghl_access_token;
  if (venue.ghl_connected && venue.ghl_refresh_token) {
    try {
      const refreshed = await refreshAccessToken(venue.ghl_refresh_token);
      if (refreshed.access_token) {
        ghlToken = refreshed.access_token;
        await supabaseAdmin.from('venues').update({
          ghl_access_token: refreshed.access_token,
          ghl_refresh_token: refreshed.refresh_token || venue.ghl_refresh_token,
        }).eq('id', venueId);
      }
    } catch (err) { console.error('[contacts] token refresh failed:', err); }
  }

  const search = request.nextUrl.searchParams.get('search') || '';
  const limit = request.nextUrl.searchParams.get('limit') || '15';

  const results: NormalizedContact[] = [];
  const seenEmails = new Set<string>();

  // Query GHL contacts
  if (venue.ghl_connected && ghlToken && venue.ghl_location_id) {
    try {
      const ghlResult = await ghlRequest(
        `/contacts/?locationId=${venue.ghl_location_id}&query=${encodeURIComponent(search)}&limit=${limit}`,
        ghlToken,
        { locationId: venue.ghl_location_id }
      );

      for (const c of ghlResult.contacts || []) {
        const email = (c.email as string) || '';
        const contact: NormalizedContact = {
          id: c.id as string,
          source: 'ghl',
          firstName: (c.firstName as string) || '',
          lastName: (c.lastName as string) || '',
          name: [c.firstName, c.lastName].filter(Boolean).join(' ') || email || 'Unknown',
          email,
          phone: (c.phone as string) || '',
        };
        results.push(contact);
        if (email) seenEmails.add(email.toLowerCase());
      }
    } catch (err) {
      console.error('[contacts] GHL search error:', err);
    }
  }

  // Query LunarPay customers and merge (deduplicate by email)
  if (venue.lunarpay_secret_key) {
    try {
      const lpResult = await listCustomers(venue.lunarpay_secret_key, search, 1, parseInt(limit));
      const raw = lpResult.data || lpResult;
      const list = Array.isArray(raw) ? raw : [];

      for (const c of list) {
        const email = (c.email as string) || '';
        if (email && seenEmails.has(email.toLowerCase())) continue;

        const firstName = (c.firstName as string) || '';
        const lastName = (c.lastName as string) || '';
        results.push({
          id: `lp_${c.id}`,
          source: 'lunarpay',
          firstName,
          lastName,
          name: (c.name as string) || [firstName, lastName].filter(Boolean).join(' ') || email || 'Unknown',
          email,
          phone: (c.phone as string) || '',
        });
        if (email) seenEmails.add(email.toLowerCase());
      }
    } catch (err) {
      console.error('[contacts] LunarPay search error:', err);
    }
  }

  if (results.length === 0 && !venue.ghl_connected && !venue.lunarpay_secret_key) {
    return NextResponse.json({ error: 'No customer sources configured' }, { status: 400 });
  }

  return NextResponse.json(results);
}
