import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getVenueId } from '@/lib/auth-helpers';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const { name, color, capacity, description, active } = await request.json();

  try {
    const sql = getDb();
    const [row] = await sql`
      UPDATE venue_spaces SET
        name        = CASE WHEN ${name        !== undefined} THEN ${name?.trim() ?? name}    ELSE name        END,
        color       = CASE WHEN ${color       !== undefined} THEN ${color        ?? null}     ELSE color       END,
        capacity    = CASE WHEN ${capacity    !== undefined} THEN ${capacity     ?? null}     ELSE capacity    END,
        description = CASE WHEN ${description !== undefined} THEN ${description  ?? null}     ELSE description END,
        active      = CASE WHEN ${active      !== undefined} THEN ${active       ?? true}     ELSE active      END
      WHERE id = ${id} AND venue_id = ${venueId}
      RETURNING *
    `;
    return NextResponse.json(row);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  try {
    const sql = getDb();
    await sql`DELETE FROM venue_spaces WHERE id = ${id} AND venue_id = ${venueId}`;
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
