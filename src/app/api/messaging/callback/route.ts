import { supabaseAdmin } from '@/lib/supabase';
import { exchangeCode } from '@/lib/ghl';
import { safeRedirect, getTrustedAppOrigin } from '@/lib/safe-redirect';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const venueId = url.searchParams.get('state');

  if (!code || !venueId) {
    return safeRedirect('/setup?error=missing_params');
  }

  const clientId = process.env.GHL_CLIENT_ID!;
  const clientSecret = process.env.GHL_CLIENT_SECRET!;
  // The redirect URI must match exactly what was registered with GHL.
  // Build it from our trusted origin — never request headers.
  const redirectUri = `${getTrustedAppOrigin()}/api/messaging/callback`;

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

    return safeRedirect('/dashboard/settings');
  } catch (err) {
    console.error('OAuth callback error:', err);
    return safeRedirect('/setup?error=oauth_failed');
  }
}
