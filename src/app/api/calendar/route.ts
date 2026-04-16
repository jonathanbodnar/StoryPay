import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getVenueId } from '@/lib/auth-helpers';

export async function GET(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = request.nextUrl;
  const from = searchParams.get('from');
  const to   = searchParams.get('to');

  try {
    const sql = getDb();
    const rows = await sql`
      SELECT
        e.*,
        CASE WHEN s.id IS NOT NULL THEN
          json_build_object('id', s.id, 'name', s.name, 'color', s.color)
        ELSE NULL END AS venue_spaces
      FROM calendar_events e
      LEFT JOIN venue_spaces s ON s.id = e.space_id
      WHERE e.venue_id = ${venueId}
        AND e.status != 'cancelled'
        ${from ? sql`AND e.start_at >= ${from}::timestamptz` : sql``}
        ${to   ? sql`AND e.start_at <= ${to}::timestamptz`   : sql``}
      ORDER BY e.start_at ASC
    `;
    return NextResponse.json(rows);
  } catch (err) {
    console.error('[calendar GET]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const {
    space_id, customer_email, title, event_type, status,
    start_at, end_at, all_day, proposal_id, notes, override_conflict,
  } = body;

  if (!title?.trim()) return NextResponse.json({ error: 'Title is required' }, { status: 400 });
  if (!start_at || !end_at) return NextResponse.json({ error: 'start_at and end_at are required' }, { status: 400 });
  if (new Date(end_at) <= new Date(start_at)) return NextResponse.json({ error: 'end_at must be after start_at' }, { status: 400 });

  try {
    const sql = getDb();

    // Conflict detection
    if (space_id && !override_conflict) {
      const conflicts = await sql`
        SELECT id, title, start_at, end_at
        FROM calendar_events
        WHERE venue_id = ${venueId}
          AND space_id = ${space_id}
          AND status != 'cancelled'
          AND start_at < ${end_at}::timestamptz
          AND end_at   > ${start_at}::timestamptz
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
      INSERT INTO calendar_events
        (venue_id, space_id, customer_email, title, event_type, status,
         start_at, end_at, all_day, proposal_id, notes, override_conflict)
      VALUES (
        ${venueId},
        ${space_id || null},
        ${customer_email || null},
        ${title.trim()},
        ${event_type || 'other'},
        ${status || 'confirmed'},
        ${start_at}::timestamptz,
        ${end_at}::timestamptz,
        ${all_day ?? false},
        ${proposal_id || null},
        ${notes || null},
        ${override_conflict ?? false}
      )
      RETURNING *
    `;

    // Fetch space details separately
    const spaceRows = space_id ? await sql`SELECT id, name, color FROM venue_spaces WHERE id = ${space_id}` : [];
    return NextResponse.json({
      ...row,
      venue_spaces: spaceRows[0] ?? null,
    }, { status: 201 });
  } catch (err) {
    console.error('[calendar POST]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
