import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { endVenueSessions } from '@/lib/venue-session';

export async function GET() {
  // Send to login page so they can easily log back in
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://storypay.io';
  const res = NextResponse.redirect(new URL('/login', base));
  // Clear the session cookies, and mark the sessions over: clearing alone let
  // an answer still on its way sign the browser straight back in.
  endVenueSessions(res, await cookies());
  return res;
}
