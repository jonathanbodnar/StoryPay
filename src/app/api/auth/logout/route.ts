import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function GET() {
  const cookieStore = await cookies();
  // Clear the venue session cookie
  cookieStore.delete('venue_id');
  // Redirect to login page
  return NextResponse.redirect(new URL('/', process.env.NEXT_PUBLIC_APP_URL || 'https://storypay.io'));
}
