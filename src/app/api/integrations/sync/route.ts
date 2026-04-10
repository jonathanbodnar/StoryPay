import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  refreshQuickBooksToken,
  refreshFreshBooksToken,
  createQuickBooksSalesReceipt,
  createFreshBooksInvoice,
} from '@/lib/accounting';

async function getVenueId() {
  const c = await cookies();
  return c.get('venue_id')?.value;
}

async function getValidToken(integration: {
  id: string;
  provider: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
}) {
  const expiresAt = new Date(integration.token_expires_at).getTime();
  const now = Date.now();

  if (expiresAt > now + 60_000) {
    return integration.access_token;
  }

  let tokens;
  if (integration.provider === 'quickbooks') {
    tokens = await refreshQuickBooksToken(integration.refresh_token);
  } else {
    tokens = await refreshFreshBooksToken(integration.refresh_token);
  }

  if (tokens.error) throw new Error(`Token refresh failed: ${tokens.error}`);

  await supabaseAdmin
    .from('venue_integrations')
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || integration.refresh_token,
      token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', integration.id);

  return tokens.access_token;
}

export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { provider, proposalIds } = await request.json();

  if (!['quickbooks', 'freshbooks'].includes(provider)) {
    return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
  }

  const { data: integration } = await supabaseAdmin
    .from('venue_integrations')
    .select('*')
    .eq('venue_id', venueId)
    .eq('provider', provider)
    .single();

  if (!integration) {
    return NextResponse.json({ error: `${provider} is not connected` }, { status: 400 });
  }

  let accessToken: string;
  try {
    accessToken = await getValidToken(integration);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Token refresh failed' }, { status: 401 });
  }

  let query = supabaseAdmin
    .from('proposals')
    .select('id, customer_name, customer_email, price, status, paid_at, created_at')
    .eq('venue_id', venueId)
    .eq('status', 'paid');

  if (proposalIds?.length) {
    query = query.in('id', proposalIds);
  }

  const { data: proposals } = await query.order('paid_at', { ascending: false });

  if (!proposals?.length) {
    return NextResponse.json({ synced: 0, message: 'No paid transactions to sync' });
  }

  const { data: alreadySynced } = await supabaseAdmin
    .from('venue_sync_log')
    .select('proposal_id')
    .eq('venue_id', venueId)
    .eq('provider', provider)
    .eq('status', 'success')
    .in('proposal_id', proposals.map(p => p.id));

  const syncedIds = new Set((alreadySynced ?? []).map(s => s.proposal_id));
  const toSync = proposalIds?.length
    ? proposals
    : proposals.filter(p => !syncedIds.has(p.id));

  if (!toSync.length) {
    return NextResponse.json({ synced: 0, message: 'All transactions already synced' });
  }

  const results: { id: string; success: boolean; error?: string; externalId?: string }[] = [];

  for (const p of toSync) {
    const txn = {
      id: p.id,
      customer_name: p.customer_name || 'Customer',
      customer_email: p.customer_email || '',
      amount: p.price,
      description: `StoryPay Payment - ${p.customer_name || 'Customer'}`,
      date: p.paid_at || p.created_at,
    };

    try {
      let result;
      if (provider === 'quickbooks') {
        result = await createQuickBooksSalesReceipt(accessToken, integration.realm_id, txn);
      } else {
        result = await createFreshBooksInvoice(accessToken, integration.account_id, txn);
      }

      const externalId = result?.SalesReceipt?.Id
        || result?.response?.result?.invoice?.id
        || result?.Id
        || null;

      await supabaseAdmin.from('venue_sync_log').insert({
        venue_id: venueId,
        provider,
        proposal_id: p.id,
        external_id: externalId ? String(externalId) : null,
        status: 'success',
      });

      results.push({ id: p.id, success: true, externalId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      await supabaseAdmin.from('venue_sync_log').insert({
        venue_id: venueId,
        provider,
        proposal_id: p.id,
        status: 'error',
        error_message: msg,
      });
      results.push({ id: p.id, success: false, error: msg });
    }
  }

  await supabaseAdmin
    .from('venue_integrations')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('id', integration.id);

  const synced = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  return NextResponse.json({ synced, failed, total: toSync.length, results });
}
