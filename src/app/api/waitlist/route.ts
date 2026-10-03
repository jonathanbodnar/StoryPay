import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The early-access waitlist is closed (owner's call, Oct 3 2026): submissions
 * are refused — no row, no email to the owner. (Its old submission email also
 * called Resend directly, skipping the test copy's quiet mode, so every test
 * run's "Wendy Waitlist" emailed the owner.) 410 Gone, for good.
 */
const gone = () => NextResponse.json({ error: 'The waitlist is closed.' }, { status: 410 });
export function GET() { return gone(); }
export function POST() { return gone(); }
