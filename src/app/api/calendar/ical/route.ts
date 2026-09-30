import { NextResponse } from 'next/server';

/**
 * GET /api/calendar/ical — retired.
 *
 * The calendar subscription feed used the venue's ID as its "token". That ID is
 * public (it's in every pricing-guide link), so anyone could download a venue's
 * whole calendar: titles, notes and client emails. Its setup screen was removed
 * in April (calendar integrations show "Coming Soon"), so nobody can get a link
 * anymore. When the feed comes back, give each venue its own random, resettable
 * feed token instead of the venue ID.
 */
export function GET() {
  return new NextResponse('This calendar feed is no longer available.', {
    status: 410,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
