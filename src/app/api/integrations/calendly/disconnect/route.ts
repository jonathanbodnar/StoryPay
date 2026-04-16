import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { deleteWebhook } from '@/lib/calendly';

export async function POST() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('calendly_access_token, calendly_webhook_id')
    .eq('id', venueId)
    .single();

  // Best-effort: delete the webhook subscription at Calendly
  if (venue?.calendly_access_token && venue?.calendly_webhook_id) {
    try {
      await deleteWebhook(venue.calendly_access_token, venue.calendly_webhook_id);
    } catch {
      // Ignore — token may already be revoked
    }
  }

  await supabaseAdmin
    .from('venues')
    .update({
      calendly_access_token: null,
      calendly_webhook_id:   null,
      calendly_user_uri:     null,
      calendly_org_uri:      null,
      calendly_connected:    false,
    })
    .eq('id', venueId);

  return NextResponse.json({ disconnected: true });
}
