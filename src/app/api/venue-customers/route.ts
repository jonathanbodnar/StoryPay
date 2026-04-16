import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getVenueId } from '@/lib/auth-helpers';

export async function GET(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const search = request.nextUrl.searchParams.get('search') ?? '';

  try {
    const sql = getDb();
    const rows = await sql`
      SELECT vc.*,
        CASE WHEN s.id IS NOT NULL THEN
          json_build_object('id', s.id, 'name', s.name, 'color', s.color)
        ELSE NULL END AS venue_spaces
      FROM venue_customers vc
      LEFT JOIN venue_spaces s ON s.id = vc.wedding_space_id
      WHERE vc.venue_id = ${venueId}
        ${search ? sql`AND (vc.first_name ILIKE ${'%' + search + '%'} OR vc.last_name ILIKE ${'%' + search + '%'} OR vc.customer_email ILIKE ${'%' + search + '%'})` : sql``}
      ORDER BY vc.created_at DESC
    `;
    return NextResponse.json(rows);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { customer_email, first_name, last_name, phone, ghl_contact_id, lunarpay_customer_id, external_id } = body;

  const email = customer_email
    ? customer_email.toLowerCase()
    : `no-email-${(external_id || `${first_name || ''}-${last_name || ''}`).toLowerCase().replace(/[^a-z0-9]/g, '-')}@storypay.internal`;

  try {
    const sql = getDb();
    const [row] = await sql`
      INSERT INTO venue_customers
        (venue_id, customer_email, first_name, last_name, phone, ghl_contact_id, lunarpay_customer_id, updated_at)
      VALUES
        (${venueId}, ${email}, ${first_name || ''}, ${last_name || ''}, ${phone || null},
         ${ghl_contact_id || null}, ${lunarpay_customer_id || null}, now())
      ON CONFLICT (venue_id, customer_email)
      DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name  = EXCLUDED.last_name,
        phone      = COALESCE(EXCLUDED.phone, venue_customers.phone),
        updated_at = now()
      RETURNING *
    `;
    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
