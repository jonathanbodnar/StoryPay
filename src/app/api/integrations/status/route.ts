import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { isConfigured } from '@/lib/accounting';

async function getVenueId() {
  const c = await cookies();
  return c.get('venue_id')?.value;
}

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: integrations } = await supabaseAdmin
    .from('venue_integrations')
    .select('id, provider, company_name, connected_at, last_synced_at, sync_enabled')
    .eq('venue_id', venueId);

  const { data: recentSyncs } = await supabaseAdmin
    .from('venue_sync_log')
    .select('id, provider, proposal_id, external_id, status, error_message, synced_at')
    .eq('venue_id', venueId)
    .order('synced_at', { ascending: false })
    .limit(20);

  return NextResponse.json({
    integrations: integrations ?? [],
    recentSyncs: recentSyncs ?? [],
    available: {
      quickbooks: isConfigured('quickbooks'),
      freshbooks: isConfigured('freshbooks'),
    },
    debug: {
      fb_client_id_set: !!process.env.FRESHBOOKS_CLIENT_ID,
      fb_secret_set: !!process.env.FRESHBOOKS_CLIENT_SECRET,
      fb_redirect_set: !!process.env.FRESHBOOKS_REDIRECT_URI,
      qb_client_id_set: !!process.env.QUICKBOOKS_CLIENT_ID,
      qb_secret_set: !!process.env.QUICKBOOKS_CLIENT_SECRET,
      qb_redirect_set: !!process.env.QUICKBOOKS_REDIRECT_URI,
    },
  });
}
