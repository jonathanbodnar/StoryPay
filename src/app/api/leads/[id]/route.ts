import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Status values enforced by the DB CHECK constraint on `public.leads.status`.
 * Keep this array in sync with the constraint.
 */
const ALLOWED_STATUSES = new Set([
  'new',
  'contacted',
  'tour_booked',
  'proposal_sent',
  'booked_wedding',
  'not_interested',
]);

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await context.params;

  let body: { status?: string; notes?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.status === 'string') {
    if (!ALLOWED_STATUSES.has(body.status)) {
      return NextResponse.json(
        { error: `Invalid status. Allowed: ${[...ALLOWED_STATUSES].join(', ')}` },
        { status: 400 },
      );
    }
    updates.status = body.status;
  }
  if (typeof body.notes === 'string') updates.notes = body.notes;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const sql = getDb();
  const rows = await sql`
    UPDATE public.leads
    SET ${sql(updates)}
    WHERE id = ${id} AND venue_id = ${venueId}
    RETURNING *
  `;

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  }
  return NextResponse.json({ lead: rows[0] });
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await context.params;
  const sql = getDb();
  const rows = await sql`
    DELETE FROM public.leads
    WHERE id = ${id} AND venue_id = ${venueId}
    RETURNING id
  `;
  if (rows.length === 0) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
