import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? '';
const REDIRECT_URI = `${process.env.NEXT_PUBLIC_APP_URL}/api/calendar/google/callback`;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const venueId = searchParams.get('state');
  const error = searchParams.get('error');

  if (error || !code || !venueId) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings/calendar?tab=connections&error=google_denied`
    );
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      throw new Error(`Token exchange failed: ${await tokenRes.text()}`);
    }

    const tokens = await tokenRes.json();
    const { access_token, refresh_token, expires_in } = tokens;

    // Get user's email from Google
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const profile = await profileRes.json();
    const accountEmail = profile.email ?? null;

    const tokenExpiry = new Date(Date.now() + (expires_in ?? 3600) * 1000).toISOString();

    // Ensure the row exists first (GET /api/calendar/settings auto-creates it,
    // but the user may have jumped straight to OAuth without visiting General tab)
    const { data: existing } = await supabaseAdmin
      .from('venue_calendar_settings')
      .select('id')
      .eq('venue_id', venueId)
      .maybeSingle();

    let saveError;
    if (existing) {
      const { error } = await supabaseAdmin
        .from('venue_calendar_settings')
        .update({
          google_connected: true,
          google_account_email: accountEmail,
          google_access_token: access_token,
          google_refresh_token: refresh_token ?? null,
          google_token_expiry: tokenExpiry,
          updated_at: new Date().toISOString(),
        })
        .eq('venue_id', venueId);
      saveError = error;
    } else {
      const { error } = await supabaseAdmin
        .from('venue_calendar_settings')
        .insert({
          venue_id: venueId,
          google_connected: true,
          google_account_email: accountEmail,
          google_access_token: access_token,
          google_refresh_token: refresh_token ?? null,
          google_token_expiry: tokenExpiry,
        });
      saveError = error;
    }

    if (saveError) {
      console.error('[google/callback] DB save error:', saveError.message);
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings/calendar?tab=connections&error=db_failed`
      );
    }

    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings/calendar?tab=connections&connected=1`
    );
  } catch (err) {
    console.error('[google/callback]', err);
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings/calendar?tab=connections&error=token_failed`
    );
  }
}
