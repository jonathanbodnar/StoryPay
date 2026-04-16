import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getVenueId } from '@/lib/auth-helpers';

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
      SELECT * FROM customer_tasks
      WHERE customer_id = ${id} AND venue_id = ${venueId}
      ORDER BY created_at ASC
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

  const { title, due_date } = await request.json();
  if (!title?.trim()) return NextResponse.json({ error: 'Title is required' }, { status: 400 });

  try {
    const sql = getDb();
    const [row] = await sql`
      INSERT INTO customer_tasks (customer_id, venue_id, title, due_date)
      VALUES (${id}, ${venueId}, ${title.trim()}, ${due_date || null})
      RETURNING *
    `;
    await sql`
      INSERT INTO customer_activity (venue_id, customer_id, activity_type, title, description)
      VALUES (${venueId}, ${id}, 'task_created', 'Task created', ${title.trim()})
    `;
    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
