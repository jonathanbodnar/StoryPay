import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

async function getVenueId() {
  const c = await cookies();
  return c.get('venue_id')?.value;
}

export const DEFAULT_NOTIFICATIONS = {
  // Email notifications
  email_payment_received:       true,
  email_payment_failed:         true,
  email_invoice_paid:           true,
  email_proposal_signed:        true,
  email_new_customer:           false,
  email_subscription_created:   true,
  email_subscription_cancelled: true,
  email_refund_issued:          true,
  email_weekly_digest:          false,
  // SMS notifications
  sms_payment_received:         false,
  sms_payment_failed:           true,
  sms_high_value_payment:       true,
  sms_proposal_signed:          false,
  sms_subscription_created:     false,
};

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await supabaseAdmin
    .from('venue_notifications')
    .select('settings')
    .eq('venue_id', venueId)
    .single();

  // Merge saved with defaults
  const saved = (data?.settings as Record<string, boolean>) ?? {};
  const merged = { ...DEFAULT_NOTIFICATIONS, ...saved };
  return NextResponse.json(merged);
}

export async function PUT(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const settings = await request.json();

  const { error } = await supabaseAdmin
    .from('venue_notifications')
    .upsert(
      { venue_id: venueId, settings, updated_at: new Date().toISOString() },
      { onConflict: 'venue_id' }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
