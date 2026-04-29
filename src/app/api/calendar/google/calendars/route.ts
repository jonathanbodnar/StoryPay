import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';

async function refreshAccessToken(venueId: string, refreshToken: string): Promise<string | null> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) return null;
  const { access_token, expires_in } = await res.json();
  const expiry = new Date(Date.now() + (expires_in ?? 3600) * 1000).toISOString();
  await supabaseAdmin
    .from('venue_calendar_settings')
    .update({ google_access_token: access_token, google_token_expiry: expiry })
    .eq('venue_id', venueId);
  return access_token as string;
}

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: settings } = await supabaseAdmin
    .from('venue_calendar_settings')
    .select('google_connected, google_access_token, google_refresh_token, google_token_expiry')
    .eq('venue_id', venueId)
    .maybeSingle();

  if (!settings?.google_connected || !settings.google_access_token) {
    return NextResponse.json({ error: 'Google Calendar not connected' }, { status: 403 });
  }

  let token = settings.google_access_token;

  // Refresh if expired
  const expiry = settings.google_token_expiry ? new Date(settings.google_token_expiry) : null;
  if (expiry && expiry < new Date() && settings.google_refresh_token) {
    const newToken = await refreshAccessToken(venueId, settings.google_refresh_token);
    if (newToken) token = newToken;
  }

  const calRes = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!calRes.ok) {
    return NextResponse.json({ error: 'Failed to fetch Google calendars' }, { status: 502 });
  }

  const calData = await calRes.json();
  const calendars = (calData.items ?? []).map((c: { id: string; summary: string; primary?: boolean }) => ({
    id: c.id,
    name: c.summary,
    primary: c.primary ?? false,
  }));

  return NextResponse.json(calendars);
}
