import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const search = request.nextUrl.searchParams.get('search')?.trim() ?? '';

  let query = supabaseAdmin
    .from('venue_customers')
    .select('*, venue_spaces:wedding_space_id(id, name, color)')
    .eq('venue_id', venueId)
    .order('created_at', { ascending: false });

  if (search) {
    const pat = `%${search}%`;
    query = query.or(
      `first_name.ilike.${pat},last_name.ilike.${pat},customer_email.ilike.${pat}`,
    );
  }

  const { data, error } = await query;
  if (error) {
    console.error('[venue-customers GET]', error);
    // Gracefully degrade if the FK to venue_spaces doesn't exist on this project.
    const { data: plain, error: plainErr } = await supabaseAdmin
      .from('venue_customers')
      .select('*')
      .eq('venue_id', venueId)
      .order('created_at', { ascending: false });
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

  return NextResponse.json(row, { status: 201 });
}
