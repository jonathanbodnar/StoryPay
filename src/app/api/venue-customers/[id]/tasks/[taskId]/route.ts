import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getVenueId } from '@/lib/auth-helpers';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: customerId, taskId } = await params;

  const body = await request.json();

  try {
    const sql = getDb();
    const [row] = await sql`
      UPDATE customer_tasks SET
        title        = CASE WHEN ${'title'        in body} THEN ${body.title?.trim()  ?? null} ELSE title        END,
        due_date     = CASE WHEN ${'due_date'     in body} THEN ${body.due_date       ?? null}::date ELSE due_date END,
        completed_at = CASE WHEN ${'completed_at' in body} THEN ${body.completed_at   ?? null}::timestamptz ELSE completed_at END
      WHERE id = ${taskId} AND customer_id = ${customerId} AND venue_id = ${venueId}
      RETURNING *
    `;
    if (body.completed_at && row) {
      await sql`
        INSERT INTO customer_activity (venue_id, customer_id, activity_type, title, description)
        VALUES (${venueId}, ${customerId}, 'task_completed', 'Task completed', ${row.title})
      `;
    }
    return NextResponse.json(row);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: customerId, taskId } = await params;

  try {
    const sql = getDb();
    await sql`
      DELETE FROM customer_tasks
      WHERE id = ${taskId} AND customer_id = ${customerId} AND venue_id = ${venueId}
    `;
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
