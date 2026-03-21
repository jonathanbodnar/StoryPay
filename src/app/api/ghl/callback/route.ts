import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { exchangeCode } from '@/lib/ghl';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const venueId = url.searchParams.get('state');

  if (!code || !venueId) {
    return NextResponse.redirect(new URL('/setup?error=missing_params', request.url));
  }

  const clientId = process.env.GHL_CLIENT_ID!;
  const clientSecret = process.env.GHL_CLIENT_SECRET!;
  const redirectUri = `${url.origin}/api/ghl/callback`;

  try {
    const tokens = await exchangeCode(code, clientId, clientSecret, redirectUri);

    await supabaseAdmin
      .from('venues')
      .update({
        ghl_access_token: tokens.access_token,
        ghl_refresh_token: tokens.refresh_token,
        ghl_location_id: tokens.locationId,
        ghl_connected: true,
      })
      .eq('id', venueId);

    return NextResponse.redirect(new URL('/setup', request.url));
  } catch (err) {
    console.error('GHL OAuth callback error:', err);
    return NextResponse.redirect(new URL('/setup?error=oauth_failed', request.url));
  }
}
