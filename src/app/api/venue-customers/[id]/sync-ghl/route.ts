/**
 * POST /api/venue-customers/[id]/sync-ghl
 *
 * Manual two-way DND sync between SaaS and GHL for one contact:
 *   1. Backfill: scan the most recent ~20 inbound SMS messages for this contact
 *      and apply STOP / START keyword side effects that may have been missed.
 *      This recovers contacts whose START text didn't trigger a GHL webhook.
 *   2. Pull: re-sync the contact from GHL to copy DND settings into our DB.
 *
 * Useful when GHL updates weren't captured by a webhook
 * (e.g. the contact texted START to re-subscribe to SMS).
 */
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { syncSingleGhlContact } from '@/lib/ghl-contacts-sync';
import {
  applySmsDndForVenueCustomer,
  applySmsOptInForVenueCustomer,
  isSmsOptOutKeyword,
  isSmsOptInKeyword,
} from '@/lib/sms-compliance';

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

  // Look up the venue_customer
  const { data: vc } = await supabaseAdmin
    .from('venue_customers')
    .select('id, venue_id, ghl_contact_id')
    .eq('id', id)
    .maybeSingle();

  if (!vc) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });

  const effectiveVenueId = (vc.venue_id as string) || venueId;
  const note: string[] = [];

  // 1. BACKFILL — scan recent inbound SMS for STOP/START keywords and apply
  //    side effects (clear/set sms_dnd, sync to GHL). Take the *most recent*
  //    keyword as the authoritative state.
  const { data: smsThreads } = await supabaseAdmin
    .from('conversation_threads')
    .select('id')
    .eq('venue_customer_id', id)
    .eq('external_reply_channel', 'sms');
  const threadIds = (smsThreads ?? []).map((t) => t.id as string);

  let backfillKeyword: 'stop' | 'start' | null = null;
  if (threadIds.length > 0) {
    const { data: recentInbound } = await supabaseAdmin
      .from('conversation_messages')
      .select('body, created_at')
      .in('thread_id', threadIds)
      .eq('sender_kind', 'contact')
      .eq('channel', 'sms')
      .order('created_at', { ascending: false })
      .limit(20);

    for (const m of recentInbound ?? []) {
      const body = String(m.body || '');
      if (isSmsOptOutKeyword(body)) { backfillKeyword = 'stop'; break; }
      if (isSmsOptInKeyword(body))  { backfillKeyword = 'start'; break; }
    }
  }

  if (backfillKeyword === 'start') {
    await applySmsOptInForVenueCustomer({
      venueId:         effectiveVenueId,
      venueCustomerId: id,
      source:          'manual_sync_backfill_start',
    });
    note.push('Detected START keyword in recent SMS — re-enabled SMS + restored AI');
  } else if (backfillKeyword === 'stop') {
    await applySmsDndForVenueCustomer({
      venueId:         effectiveVenueId,
      venueCustomerId: id,
      source:          'manual_sync_backfill_stop',
    });
    note.push('Detected STOP keyword in recent SMS — applied SMS opt-out');
  }

  // 2. PULL from GHL (if linked) so DND boxes reflect GHL's current state
  if (vc.ghl_contact_id) {
    const { data: venue } = await supabaseAdmin
      .from('venues')
      .select('id, ghl_location_id, ghl_connected')
      .eq('id', effectiveVenueId)
      .maybeSingle();

    if (venue?.ghl_connected && venue.ghl_location_id) {
      const ok = await syncSingleGhlContact(venue.ghl_location_id, vc.ghl_contact_id);
      if (ok) {
        note.push('Pulled latest DND state from GHL');
      } else {
        note.push('GHL pull failed (token issue)');
      }
    }
  } else {
    note.push('No GHL contact linked — skipped GHL pull');
  }

  // Re-fetch updated venue_customer for fresh DND state
  const { data: fresh } = await supabaseAdmin
    .from('venue_customers')
    .select('id, sms_dnd, ghl_dnd_settings, ghl_inbound_dnd_settings, ghl_synced_at')
    .eq('id', id)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    contact: fresh,
    notes: note,
    backfillKeyword,
  });
}
