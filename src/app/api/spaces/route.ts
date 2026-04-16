import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getVenueId } from '@/lib/auth-helpers';

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const sql = getDb();
    const rows = await sql`
      SELECT * FROM venue_spaces WHERE venue_id = ${venueId} ORDER BY created_at ASC
    `;
    return NextResponse.json(rows);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { name, color, capacity, description } = await request.json();
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

  try {
    const sql = getDb();
    const [row] = await sql`
      INSERT INTO venue_spaces (venue_id, name, color, capacity, description)
      VALUES (${venueId}, ${name.trim()}, ${color || '#6366f1'}, ${capacity || null}, ${description || null})
      RETURNING *
    `;
    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
