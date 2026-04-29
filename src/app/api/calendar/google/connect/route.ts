import { NextResponse } from 'next/server';
import { getVenueId } from '@/lib/auth-helpers';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '';
const REDIRECT_URI = `${process.env.NEXT_PUBLIC_APP_URL}/api/calendar/google/callback`;

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!GOOGLE_CLIENT_ID) {
    return NextResponse.json(
      { error: 'Google Calendar integration is not configured. Please add GOOGLE_CLIENT_ID to environment variables.' },
      { status: 503 }
    );
  }

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent select_account',
    state: venueId,
  });

  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}
