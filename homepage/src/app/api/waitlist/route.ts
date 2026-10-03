import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * The early-access waitlist is closed (owner's call, Oct 3 2026): the landing
 * page no longer offers it, and a direct submission is refused — no row, no
 * email. 410 Gone tells old tabs and crawlers it's gone for good.
 */
const gone = () => NextResponse.json({ error: 'The waitlist is closed.' }, { status: 410 });
export function GET() { return gone(); }
export function POST() { return gone(); }
