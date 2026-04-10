import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  exchangeQuickBooksCode,
  exchangeFreshBooksCode,
} from '@/lib/accounting';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const realmId = url.searchParams.get('realmId');

  if (!code || !state) {
    return NextResponse.redirect(new URL('/dashboard/settings/integrations?error=missing_params', request.url));
  }

  let parsed: { venueId: string; provider: string };
  try {
    parsed = JSON.parse(Buffer.from(state, 'base64url').toString());
  } catch {
    return NextResponse.redirect(new URL('/dashboard/settings/integrations?error=invalid_state', request.url));
  }

  const { venueId, provider } = parsed;

  try {
    if (provider === 'quickbooks') {
      const tokens = await exchangeQuickBooksCode(code);
      if (tokens.error) {
        return NextResponse.redirect(new URL(`/dashboard/settings/integrations?error=${tokens.error}`, request.url));
      }

      await supabaseAdmin
        .from('venue_integrations')
        .upsert({
          venue_id: venueId,
          provider: 'quickbooks',
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
          realm_id: realmId || null,
          company_name: 'QuickBooks',
          connected_at: new Date().toISOString(),
          sync_enabled: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'venue_id,provider' });

      return NextResponse.redirect(new URL('/dashboard/settings/integrations?connected=quickbooks', request.url));
    }

    if (provider === 'freshbooks') {
      const tokens = await exchangeFreshBooksCode(code);
      if (tokens.error) {
        return NextResponse.redirect(new URL(`/dashboard/settings/integrations?error=${tokens.error}`, request.url));
      }

      let accountId = '';
      let companyName = 'FreshBooks';
      try {
        const meRes = await fetch('https://api.freshbooks.com/auth/api/v1/users/me', {
          headers: { 'Authorization': `Bearer ${tokens.access_token}` },
        });
        const me = await meRes.json();
        const membership = me?.response?.memberships?.[0];
        if (membership) {
          accountId = String(membership.business?.account_id || membership.account_id || '');
          companyName = membership.business?.name || 'FreshBooks';
        }
      } catch { /* best-effort */ }

      await supabaseAdmin
        .from('venue_integrations')
        .upsert({
          venue_id: venueId,
          provider: 'freshbooks',
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
          account_id: accountId,
          company_name: companyName,
          connected_at: new Date().toISOString(),
          sync_enabled: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'venue_id,provider' });

      return NextResponse.redirect(new URL('/dashboard/settings/integrations?connected=freshbooks', request.url));
    }
  } catch (err) {
    console.error('[integrations/callback] error:', err);
    return NextResponse.redirect(new URL('/dashboard/settings/integrations?error=exchange_failed', request.url));
  }

  return NextResponse.redirect(new URL('/dashboard/settings/integrations?error=invalid_provider', request.url));
}
