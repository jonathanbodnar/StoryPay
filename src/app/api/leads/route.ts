import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

/**
 * GET /api/leads?status=new|contacted|archived&q=text
 * Returns leads for the current logged-in venue, newest first.
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
      l.*,
      vl.slug AS listing_slug,
      vl.name AS listing_name
    FROM public.leads l
    LEFT JOIN public.venue_listings vl ON vl.id = l.venue_listing_id
    WHERE l.storypay_venue_id = ${venueId}
      ${status ? sql`AND l.status = ${status}` : sql``}
      ${q ? sql`AND (l.name ILIKE ${'%' + q + '%'} OR l.email ILIKE ${'%' + q + '%'} OR l.phone ILIKE ${'%' + q + '%'})` : sql``}
    ORDER BY l.created_at DESC
    LIMIT 500
  `;

  return NextResponse.json({ leads: rows });
}
