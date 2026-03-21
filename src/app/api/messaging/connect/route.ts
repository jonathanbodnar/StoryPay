import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getOAuthUrl } from '@/lib/ghl';

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;

  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const clientId = process.env.GHL_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: 'Messaging client ID not configured' }, { status: 500 });
  }

  const { origin } = new URL(request.url);
  const redirectUri = `${origin}/api/messaging/callback`;
  const oauthUrl = getOAuthUrl(clientId, redirectUri, venueId);

  return NextResponse.redirect(oauthUrl);
}
