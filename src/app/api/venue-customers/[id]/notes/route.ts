import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getVenueId, getMemberName } from '@/lib/auth-helpers';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  try {
    const sql = getDb();
    const rows = await sql`
      SELECT * FROM customer_notes
      WHERE customer_id = ${id} AND venue_id = ${venueId}
      ORDER BY created_at DESC
    `;
    return NextResponse.json(rows);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const { content } = await request.json();
  if (!content?.trim()) return NextResponse.json({ error: 'Content is required' }, { status: 400 });

  const authorName = await getMemberName();

  try {
    const sql = getDb();
    const [row] = await sql`
      INSERT INTO customer_notes (customer_id, venue_id, content, author_name)
      VALUES (${id}, ${venueId}, ${content.trim()}, ${authorName})
      RETURNING *
    `;
    await sql`
      INSERT INTO customer_activity (venue_id, customer_id, activity_type, title, description)
      VALUES (${venueId}, ${id}, 'note_added', 'Note added', ${content.trim().slice(0, 120)})
    `;
    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: customerId } = await params;
  const noteId = request.nextUrl.searchParams.get('noteId');
  if (!noteId) return NextResponse.json({ error: 'noteId required' }, { status: 400 });

  try {
    const sql = getDb();
    await sql`
      DELETE FROM customer_notes
      WHERE id = ${noteId} AND customer_id = ${customerId} AND venue_id = ${venueId}
    `;
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
