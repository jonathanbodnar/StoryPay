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

  const body = await request.json();
  const { space_id, customer_email, title, event_type, status, start_at, end_at, all_day, notes, override_conflict } = body;

  try {
    const sql = getDb();

    // Conflict check on reschedule
    if (space_id && !override_conflict && (start_at || end_at)) {
      const [current] = await sql`SELECT start_at, end_at FROM calendar_events WHERE id = ${id}`;
      const newStart = start_at ?? current?.start_at;
      const newEnd   = end_at   ?? current?.end_at;

      const conflicts = await sql`
        SELECT id, title, start_at, end_at
        FROM calendar_events
        WHERE venue_id = ${venueId}
          AND space_id = ${space_id}
          AND status != 'cancelled'
          AND id != ${id}
          AND start_at < ${newEnd}::timestamptz
          AND end_at   > ${newStart}::timestamptz
      `;
      if (conflicts.length > 0) {
        return NextResponse.json({
          error: 'conflict',
          message: 'This space already has an event during that time.',
          conflicts: conflicts.map(c => ({ id: c.id, title: c.title, start_at: c.start_at, end_at: c.end_at })),
        }, { status: 409 });
      }
    }

    const [row] = await sql`
      UPDATE calendar_events SET
        space_id          = CASE WHEN ${space_id !== undefined}       THEN ${space_id || null}::uuid      ELSE space_id          END,
        customer_email    = CASE WHEN ${customer_email !== undefined} THEN ${customer_email || null}      ELSE customer_email    END,
        title             = CASE WHEN ${title !== undefined}          THEN ${title?.trim() ?? title}      ELSE title             END,
        event_type        = CASE WHEN ${event_type !== undefined}     THEN ${event_type}::calendar_event_type ELSE event_type    END,
        status            = CASE WHEN ${status !== undefined}         THEN ${status}::calendar_event_status   ELSE status        END,
        start_at          = CASE WHEN ${start_at !== undefined}       THEN ${start_at || null}::timestamptz   ELSE start_at      END,
        end_at            = CASE WHEN ${end_at !== undefined}         THEN ${end_at || null}::timestamptz     ELSE end_at        END,
        all_day           = CASE WHEN ${all_day !== undefined}        THEN ${all_day ?? false}             ELSE all_day          END,
        notes             = CASE WHEN ${notes !== undefined}          THEN ${notes || null}               ELSE notes             END,
        override_conflict = CASE WHEN ${override_conflict !== undefined} THEN ${override_conflict ?? false} ELSE override_conflict END,
        updated_at        = now()
      WHERE id = ${id} AND venue_id = ${venueId}
      RETURNING *
    `;

    const spaceRows = row?.space_id ? await sql`SELECT id, name, color FROM venue_spaces WHERE id = ${row.space_id}` : [];
    return NextResponse.json({ ...row, venue_spaces: spaceRows[0] ?? null });
  } catch (err) {
    console.error('[calendar PATCH]', err);
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
    await sql`DELETE FROM calendar_events WHERE id = ${id} AND venue_id = ${venueId}`;
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
