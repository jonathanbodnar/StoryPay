import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { exchangeCode } from '@/lib/ghl';

function getBaseUrl(request: Request): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) return appUrl;
  const url = new URL(request.url);
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  return host ? `${proto}://${host}` : url.origin;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const venueId = url.searchParams.get('state');
  const base = getBaseUrl(request);

  if (!code || !venueId) {
    return NextResponse.redirect(`${base}/setup?error=missing_params`);
  }

  const clientId = process.env.GHL_CLIENT_ID!;
  const clientSecret = process.env.GHL_CLIENT_SECRET!;
  const redirectUri = `${base}/api/messaging/callback`;

  try {
    const tokens = await exchangeCode(code, clientId, clientSecret, redirectUri);

    await supabaseAdmin
      .from('venues')
      .update({
        ghl_access_token: tokens.access_token,
        ghl_refresh_token: tokens.refresh_token,
        ghl_location_id: tokens.locationId,
        ghl_location_token: tokens.access_token,
        ghl_connected: true,
      })
      .eq('id', venueId);

    return NextResponse.redirect(`${base}/dashboard/settings`);
  } catch (err) {
    console.error('OAuth callback error:', err);
    return NextResponse.redirect(`${base}/setup?error=oauth_failed`);
  }
}
