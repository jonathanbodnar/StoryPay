import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { getEffectiveVenueId } from '@/lib/effective-venue';
import { schedulePushVenueCustomerToGhl } from '@/lib/ghl-push-contact';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * PostgREST `.or()` parses each clause as column.operator.value using `.` as delimiter.
 * Unquoted ilike patterns containing `.` (e.g. `%user@gmail.com%`) break parsing, so
 * values must be wrapped in double quotes; double quotes inside are escaped as `""`.
 */
function venueCustomerSearchOrFilter(searchRaw: string): string {
  const escaped = searchRaw
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
  const pat = `%${escaped}%`;
  const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const p = q(pat);
  return `first_name.ilike.${p},last_name.ilike.${p},customer_email.ilike.${p},phone.ilike.${p}`;
}

export async function GET(request: NextRequest) {
  const venueId = await getEffectiveVenueId(request);
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const search   = request.nextUrl.searchParams.get('search')?.trim() ?? '';
  const limitParam = parseInt(request.nextUrl.searchParams.get('limit') ?? '500', 10);
  const pageLimit = search ? 80 : Math.min(limitParam, 500);

  let query = supabaseAdmin
    .from('venue_customers')
    .select('*, venue_spaces:wedding_space_id(id, name, color)')
    .eq('venue_id', venueId)
    .order('created_at', { ascending: false })
    .limit(pageLimit);

  if (search) {
    query = query.or(venueCustomerSearchOrFilter(search));
  }

  const { data, error } = await query;
  if (error) {
    console.error('[venue-customers GET]', error);
    // Gracefully degrade if the FK to venue_spaces doesn't exist on this project.
    let plainQuery = supabaseAdmin
      .from('venue_customers')
      .select('*')
      .eq('venue_id', venueId)
      .order('created_at', { ascending: false })
      .limit(pageLimit);
    if (search) {
      plainQuery = plainQuery.or(venueCustomerSearchOrFilter(search));
    }
    const { data: plain, error: plainErr } = await plainQuery;
    if (plainErr) {
      return NextResponse.json({ error: plainErr.message }, { status: 500 });
    }
    return NextResponse.json(plain ?? []);
  }

  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const {
    customer_email,
    first_name,
    last_name,
    phone,
    ghl_contact_id,
    lunarpay_customer_id,
    external_id,
  } = body;

  const email = customer_email
    ? String(customer_email).toLowerCase()
    : `no-email-${(external_id || `${first_name || ''}-${last_name || ''}`)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')}@storypay.internal`;

  const { data: row, error } = await supabaseAdmin
    .from('venue_customers')
    .upsert(
      {
        venue_id:             venueId,
        customer_email:       email,
        first_name:           first_name || '',
        last_name:            last_name  || '',
        phone:                phone || null,
        ghl_contact_id:       ghl_contact_id || null,
        lunarpay_customer_id: lunarpay_customer_id || null,
        updated_at:           new Date().toISOString(),
      },
      { onConflict: 'venue_id,customer_email' },
    )
    .select('*')
    .single();

  if (error || !row) {
    console.error('[venue-customers POST]', error);
    return NextResponse.json(
      { error: error?.message ?? 'Failed to save customer' },
      { status: 500 },
    );
  }

  // Push the new (or upserted) contact to GoHighLevel so SaaS-originated
  // contacts immediately exist in GHL with the right fields. Fire-and-forget
  // so we don't slow the 201 response on a slow upstream API.
  schedulePushVenueCustomerToGhl({
    venueId,
    venueCustomerId: (row as { id: string }).id,
    reason: 'contact_create',
  });

  return NextResponse.json(row, { status: 201 });
}
