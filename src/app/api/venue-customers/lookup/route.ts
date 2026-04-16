import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getVenueId } from '@/lib/auth-helpers';

export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { email } = await request.json();
  if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 });

  try {
    const sql = getDb();
    const [row] = await sql`
      SELECT vc.*,
        CASE WHEN s.id IS NOT NULL THEN
          json_build_object('id', s.id, 'name', s.name, 'color', s.color)
        ELSE NULL END AS venue_spaces
      FROM venue_customers vc
      LEFT JOIN venue_spaces s ON s.id = vc.wedding_space_id
      WHERE vc.venue_id = ${venueId}
        AND vc.customer_email = ${email.toLowerCase()}
    `;
    return NextResponse.json(row ?? null);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
