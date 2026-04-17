import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { listCustomers, createCustomer } from '@/lib/lunarpay';
import { ghlRequest, refreshAccessToken } from '@/lib/ghl';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('lunarpay_secret_key, ghl_connected, ghl_access_token, ghl_refresh_token, ghl_location_id')
    .eq('id', venueId)
    .single();

  if (!venue) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

  // Auto-refresh GHL token if connected
  let ghlToken = venue.ghl_access_token;
  if (venue.ghl_connected && venue.ghl_refresh_token) {
    try {
      const refreshed = await refreshAccessToken(venue.ghl_refresh_token);
      if (refreshed.access_token) {
        ghlToken = refreshed.access_token;
        await supabaseAdmin.from('venues').update({
          ghl_access_token:  refreshed.access_token,
          ghl_refresh_token: refreshed.refresh_token || venue.ghl_refresh_token,
        }).eq('id', venueId);
      }
    } catch (err) {
      console.error('[customers] GHL token refresh failed:', err);
      // Use existing token and hope it still works
    }
  }

  const search   = request.nextUrl.searchParams.get('search') || '';
  const page     = parseInt(request.nextUrl.searchParams.get('page') || '1', 10);
  const limit    = parseInt(request.nextUrl.searchParams.get('limit') || '100', 10);

  console.log(`[customers] venueId=${venueId} ghl_connected=${venue.ghl_connected} ghl_location=${venue.ghl_location_id} has_token=${!!venue.ghl_access_token} has_lp=${!!venue.lunarpay_secret_key}`);

  const merged: Record<string, unknown>[] = [];
  const seenEmails = new Set<string>();

  // ── Pull from GHL (primary source for contact info) ──────────────────────
  if (venue.ghl_connected && ghlToken && venue.ghl_location_id) {
    try {
      const ghlResult = await ghlRequest(
        `/contacts/?locationId=${venue.ghl_location_id}&query=${encodeURIComponent(search)}&limit=${limit}`,
        ghlToken,
        { locationId: venue.ghl_location_id }
      );
      console.log(`[customers] GHL returned ${(ghlResult.contacts||[]).length} contacts for location ${venue.ghl_location_id}`);
      for (const c of ghlResult.contacts || []) {
        const email = ((c.email as string) || '').toLowerCase();
        const id    = c.id as string;
        merged.push({
          id,
          name: [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || 'Unknown',
          firstName: c.firstName || '',
          lastName:  c.lastName  || '',
          email:     c.email     || '',
          phone:     c.phone     || '',
          source:    'ghl',
        });
        if (email) seenEmails.add(email);
      }
    } catch (err) {
      console.error('[customers] GHL fetch error:', err);
    }
  }

  // ── Pull from LunarPay (merge, deduplicate by email) ─────────────────────
  if (venue.lunarpay_secret_key) {
    try {
      const lpResult = await listCustomers(venue.lunarpay_secret_key, search, page, limit);
      const raw  = lpResult.data || lpResult;
      const list = Array.isArray(raw) ? raw : [];
      for (const c of list) {
        const email = ((c.email as string) || '').toLowerCase();
        if (email && seenEmails.has(email)) continue; // already in from GHL
        const firstName = (c.firstName as string) || '';
        const lastName  = (c.lastName  as string) || '';
        merged.push({
          id:        c.id,
          name:      (c.name as string) || [firstName, lastName].filter(Boolean).join(' ') || c.email || 'Unknown',
          firstName,
          lastName,
          email:     c.email || '',
          phone:     c.phone || '',
          source:    'lunarpay',
        });
        if (email) seenEmails.add(email);
      }
    } catch (err) {
      console.error('[customers] LunarPay fetch error:', err);
    }
  }

  // ── Pull from our own venue_customers table (StoryPay-native CRM) ────────
  // Ensures customers that were created before LunarPay/GHL were connected
  // (or without them at all) still show up in the list.
  try {
    const { data: rows, error } = await supabaseAdmin
      .from('venue_customers')
      .select('id, customer_email, first_name, last_name, phone, ghl_contact_id, lunarpay_customer_id')
      .eq('venue_id', venueId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[customers] venue_customers fetch error:', error);
    } else {
      for (const c of rows ?? []) {
        const email = (c.customer_email || '').toLowerCase();
        if (email && seenEmails.has(email)) continue;
        merged.push({
          id:        c.lunarpay_customer_id || c.ghl_contact_id || c.id,
          name:      [c.first_name, c.last_name].filter(Boolean).join(' ') || c.customer_email || 'Unknown',
          firstName: c.first_name || '',
          lastName:  c.last_name  || '',
          email:     c.customer_email || '',
          phone:     c.phone || '',
          source:    'storypay',
        });
        if (email) seenEmails.add(email);
      }
    }
  } catch (err) {
    console.error('[customers] venue_customers fetch error:', err);
  }

  // Client-side search filter when GHL doesn't support it natively
  const filtered = search
    ? merged.filter(c => {
        const q = search.toLowerCase();
        return (
          String(c.name  || '').toLowerCase().includes(q) ||
          String(c.email || '').toLowerCase().includes(q) ||
          String(c.phone || '').toLowerCase().includes(q)
        );
      })
    : merged;

  return NextResponse.json(filtered);
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { firstName, lastName, email, phone, address, city, state, zip } = body;

  if (!firstName || !lastName || !email) {
    return NextResponse.json({ error: 'firstName, lastName, and email are required' }, { status: 400 });
  }

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('lunarpay_secret_key')
    .eq('id', venueId)
    .single();

  // Best-effort LunarPay sync (only when the venue has connected it).
  let lunarpayCustomerId: string | null = null;
  let lunarpayError: string | null = null;
  if (venue?.lunarpay_secret_key) {
    try {
      const lp = await createCustomer(venue.lunarpay_secret_key, {
        name: `${firstName} ${lastName}`,
        email,
        phone:   phone   || undefined,
        address: address || undefined,
        city:    city    || undefined,
        state:   state   || undefined,
        zip:     zip     || undefined,
      });
      lunarpayCustomerId = String((lp as { id?: string | number })?.id ?? '') || null;
    } catch (err) {
      lunarpayError = err instanceof Error ? err.message : 'LunarPay sync failed';
      console.error('[customers] LunarPay sync error:', err);
    }
  }

  // Always persist to StoryPay's own venue_customers table. This is the source
  // of truth inside the dashboard — LunarPay / GHL are downstream sinks.
  const { data: row, error: dbErr } = await supabaseAdmin
    .from('venue_customers')
    .upsert(
      {
        venue_id:             venueId,
        customer_email:       email.toLowerCase(),
        first_name:           firstName,
        last_name:            lastName,
        phone:                phone || null,
        lunarpay_customer_id: lunarpayCustomerId,
        updated_at:           new Date().toISOString(),
      },
      { onConflict: 'venue_id,customer_email' },
    )
    .select('id, customer_email, first_name, last_name, phone, lunarpay_customer_id, ghl_contact_id')
    .single();

  if (dbErr || !row) {
    console.error('[customers] venue_customers upsert error:', dbErr);
    return NextResponse.json(
      { error: `Failed to save customer: ${dbErr?.message ?? 'unknown error'}` },
      { status: 500 },
    );
  }

  const customer = {
    id:        row.lunarpay_customer_id || row.ghl_contact_id || row.id,
    name:      [row.first_name, row.last_name].filter(Boolean).join(' ') || row.customer_email,
    firstName: row.first_name,
    lastName:  row.last_name,
    email:     row.customer_email,
    phone:     row.phone || '',
    source:    row.lunarpay_customer_id ? 'lunarpay' : 'storypay',
  };

  return NextResponse.json(
    { ...customer, warnings: lunarpayError ? [lunarpayError] : undefined },
    { status: 201 },
  );
}
