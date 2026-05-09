/**
 * POST /api/venue-customers/[id]/sync-ghl
 *
 * Pulls the latest DND + contact data from GHL and writes it to the local
 * venue_customer record. Useful when GHL updates weren't captured by a webhook
 * (e.g. the contact texted START to re-subscribe to SMS).
 */
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { syncSingleGhlContact } from '@/lib/ghl-contacts-sync';

export const dynamic = 'force-dynamic';
export const runtime  = 'nodejs';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const c       = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  // Look up the venue_customer to get ghl_contact_id
  const { data: vc } = await supabaseAdmin
    .from('venue_customers')
    .select('id, ghl_contact_id')
    .eq('id', id)
    .maybeSingle();

  if (!vc) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  if (!vc.ghl_contact_id) return NextResponse.json({ error: 'No GHL contact linked' }, { status: 400 });

  // Get the venue's GHL location ID
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id, ghl_location_id, ghl_connected')
    .eq('id', venueId)
    .maybeSingle();

  if (!venue?.ghl_connected || !venue.ghl_location_id) {
    return NextResponse.json({ error: 'GHL not connected' }, { status: 400 });
  }

  const ok = await syncSingleGhlContact(venue.ghl_location_id, vc.ghl_contact_id);
  if (!ok) return NextResponse.json({ error: 'GHL sync failed — check API token' }, { status: 502 });

  // Re-fetch updated venue_customer for fresh DND state
  const { data: fresh } = await supabaseAdmin
    .from('venue_customers')
    .select('id, sms_dnd, ghl_dnd_settings, ghl_inbound_dnd_settings, ghl_synced_at')
    .eq('id', id)
    .maybeSingle();

  return NextResponse.json({ ok: true, contact: fresh });
}
