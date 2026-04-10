import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { lpFetch } from '@/lib/lunarpay';
import { ghlRequest, refreshAccessToken } from '@/lib/ghl';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('lunarpay_secret_key, ghl_connected, ghl_access_token, ghl_refresh_token, ghl_location_id')
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
    } catch { /* use existing token */ }
  }

  // Determine source: LunarPay IDs are numeric, GHL IDs are alphanumeric strings
  const isLunarPayId = /^\d+$/.test(id);

  let customer: Record<string, unknown> | null = null;
  let customerEmail = '';

  if (isLunarPayId && venue.lunarpay_secret_key) {
    try {
      const result = await lpFetch(`/api/v1/customers/${id}`, { method: 'GET', key: venue.lunarpay_secret_key });
      const c = result.data || result;
      customerEmail = c.email || '';
      customer = {
        id: c.id,
        name: c.name || [c.firstName, c.lastName].filter(Boolean).join(' '),
        firstName: c.firstName || '',
        lastName:  c.lastName  || '',
        email:     c.email     || '',
        phone:     c.phone     || '',
        address:   c.address   || '',
        city:      c.city      || '',
        state:     c.state     || '',
        zip:       c.zip       || '',
      };
    } catch (err) {
      console.error('[customer detail] LunarPay error:', err);
    }
  }

  // Try GHL if not found via LunarPay or if it's a GHL ID
  if (!customer && ghlToken && venue.ghl_location_id) {
    try {
      const result = await ghlRequest(`/contacts/${id}`, ghlToken, { locationId: venue.ghl_location_id });
      const c = result.contact || result;
      customerEmail = c.email || '';
      customer = {
        id: c.id,
        name: [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || 'Unknown',
        firstName: c.firstName || '',
        lastName:  c.lastName  || '',
        email:     c.email     || '',
        phone:     c.phone     || '',
        address:   c.address   || '',
        city:      c.city      || '',
        state:     c.state     || '',
        zip:       c.postalCode || '',
      };
    } catch (err) {
      console.error('[customer detail] GHL error:', err);
    }
  }

  if (!customer) {
    return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
  }

  // Fetch proposals by email
  const { data: proposals } = customerEmail
    ? await supabaseAdmin
        .from('proposals')
        .select('id, customer_name, customer_email, status, price, payment_type, payment_config, public_token, sent_at, signed_at, paid_at, created_at, charge_id')
        .eq('venue_id', venueId)
        .eq('customer_email', customerEmail)
        .order('created_at', { ascending: false })
    : { data: [] };

  return NextResponse.json({ customer, proposals: proposals || [] });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { firstName, lastName, email, phone, address, city, state, zip } = await request.json();
  const name = [firstName, lastName].filter(Boolean).join(' ');

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('lunarpay_secret_key, ghl_connected, ghl_access_token, ghl_refresh_token, ghl_location_id')
    .eq('id', venueId)
    .single();

  if (!venue) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

  // Refresh GHL token
  let ghlToken = venue.ghl_access_token;
  if (venue.ghl_connected && venue.ghl_refresh_token) {
    try {
      const refreshed = await refreshAccessToken(venue.ghl_refresh_token);
      if (refreshed.access_token) {
        ghlToken = refreshed.access_token;
        await supabaseAdmin.from('venues').update({ ghl_access_token: refreshed.access_token, ghl_refresh_token: refreshed.refresh_token || venue.ghl_refresh_token }).eq('id', venueId);
      }
    } catch { /* continue */ }
  }

  const errors: string[] = [];

  // Update in LunarPay if numeric ID
  if (venue.lunarpay_secret_key && /^\d+$/.test(id)) {
    try {
      await lpFetch(`/api/v1/customers/${id}`, {
        method: 'PUT',
        body: { firstName, lastName, email, phone },
        key: venue.lunarpay_secret_key,
      });
    } catch (err) {
      errors.push(`LunarPay: ${err instanceof Error ? err.message : 'update failed'}`);
    }
  }

  // Update in GHL if alphanumeric ID
  if (venue.ghl_connected && ghlToken && venue.ghl_location_id && !/^\d+$/.test(id)) {
    try {
      await ghlRequest(`/contacts/${id}`, ghlToken, {
        method: 'PUT',
        body: { firstName, lastName, email, phone, address1: address, city, state, postalCode: zip },
        locationId: venue.ghl_location_id,
      });
    } catch (err) {
      errors.push(`GHL: ${err instanceof Error ? err.message : 'update failed'}`);
    }
  }

  // Return updated customer shape
  const updatedCustomer = { id, name, firstName, lastName, email, phone, address, city, state, zip };
  return NextResponse.json({ customer: updatedCustomer, warnings: errors.length ? errors : undefined });
}

