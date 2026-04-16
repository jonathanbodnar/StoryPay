import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { getCalendlyUser, createWebhook } from '@/lib/calendly';

export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { access_token } = await request.json();
  if (!access_token?.trim()) return NextResponse.json({ error: 'Personal Access Token is required' }, { status: 400 });

  const token = access_token.trim();

  // Validate the token by fetching the Calendly user
  let user;
  try {
    user = await getCalendlyUser(token);
  } catch (err) {
    return NextResponse.json(
      { error: 'Invalid token — could not connect to Calendly. Make sure you pasted the full Personal Access Token.' },
      { status: 400 }
    );
  }

  // Register a webhook so bookings arrive in real time
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://www.storypay.io';

  const callbackUrl = `${appUrl}/api/webhooks/calendly`;

  let webhookUri = '';
  try {
    webhookUri = await createWebhook(token, user.current_organization, callbackUrl);
  } catch (err) {
    // Non-fatal: webhook registration can fail if the URL isn't publicly reachable (local dev).
    // The venue is still connected; they can use the manual sync button.
    console.warn('[calendly connect] webhook registration failed:', err);
  }

  await supabaseAdmin
    .from('venues')
    .update({
      calendly_access_token: token,
      calendly_user_uri:     user.uri,
      calendly_org_uri:      user.current_organization,
      calendly_webhook_id:   webhookUri || null,
      calendly_connected:    true,
    })
    .eq('id', venueId);

  return NextResponse.json({
    connected: true,
    user_name: user.name,
    user_email: user.email,
    webhook_registered: !!webhookUri,
  });
}
