import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

/**
 * GET /api/leads?status=<status>&q=<text>
 *
 * Returns leads for the current logged-in venue, newest first. Joins
 * `venues` so the UI can surface the listing slug/name alongside each lead
 * (handy when a single account ever manages multiple listings in the future).
 */
export async function GET(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const q = searchParams.get('q')?.trim() ?? '';

  const sql = getDb();

  const rows = await sql`
    SELECT
      l.id, l.venue_id, l.name, l.email, l.phone,
      l.wedding_date, l.guest_count, l.booking_timeline,
      l.message, l.notes, l.status, l.source,
      l.created_at, l.updated_at,
      v.slug AS listing_slug,
      v.name AS listing_name
    FROM public.leads l
    LEFT JOIN public.venues v ON v.id = l.venue_id
    WHERE l.venue_id = ${venueId}
      ${status ? sql`AND l.status = ${status}` : sql``}
      ${q ? sql`AND (l.name ILIKE ${'%' + q + '%'} OR l.email ILIKE ${'%' + q + '%'} OR l.phone ILIKE ${'%' + q + '%'})` : sql``}
    ORDER BY l.created_at DESC
    LIMIT 500
  `;

  return NextResponse.json({ leads: rows });
}
