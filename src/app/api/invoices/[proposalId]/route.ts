import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getPaymentSchedule, getSubscription } from '@/lib/lunarpay';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ proposalId: string }> }
) {
  const { proposalId } = await params;

  const { data: proposal, error } = await supabaseAdmin
    .from('proposals')
    .select('*, venues(name, logo_url)')
    .eq('id', proposalId)
    .single();

  if (error || !proposal) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  }

  const venue = proposal.venues as { name: string; logo_url: string | null } | null;
  let scheduleData = null;
  let subscriptionData = null;

  if (proposal.payment_schedule_id || proposal.subscription_id) {
    const { data: venueKeys } = await supabaseAdmin
      .from('venues')
      .select('lunarpay_secret_key')
      .eq('id', proposal.venue_id)
      .single();

    if (venueKeys?.lunarpay_secret_key) {
      try {
        if (proposal.payment_schedule_id) {
          scheduleData = await getPaymentSchedule(
            venueKeys.lunarpay_secret_key,
            proposal.payment_schedule_id
          );
        }
        if (proposal.subscription_id) {
          subscriptionData = await getSubscription(
            venueKeys.lunarpay_secret_key,
            proposal.subscription_id
          );
        }
      } catch (err) {
        console.error('Failed to fetch payment details:', err);
      }
    }
  }

  return NextResponse.json({
    proposal_id: proposal.id,
    customer_name: proposal.customer_name,
    customer_email: proposal.customer_email,
    content: proposal.content,
    price: proposal.price,
    payment_type: proposal.payment_type,
    payment_config: proposal.payment_config,
    status: proposal.status,
    paid_at: proposal.paid_at,
    signed_at: proposal.signed_at,
    created_at: proposal.created_at,
    venue_name: venue?.name ?? '',
    venue_logo_url: venue?.logo_url ?? null,
    schedule: scheduleData,
    subscription: subscriptionData,
  });
}
