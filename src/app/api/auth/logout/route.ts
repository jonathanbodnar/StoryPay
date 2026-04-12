import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function GET() {
  const cookieStore = await cookies();
  // Clear session cookies
  cookieStore.delete('venue_id');
  cookieStore.delete('member_id');
  // Send to login page so they can easily log back in
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://storypay.io';
  return NextResponse.redirect(new URL('/login', base));
}
