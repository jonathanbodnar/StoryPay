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
    .select('*, venues(name, logo_url, pass_service_fee, brand_logo_url, brand_tagline, brand_email, brand_phone, brand_website, brand_color, brand_address, brand_city, brand_state, brand_zip, brand_footer_note)')
    .eq('id', proposalId)
    .single();

  if (error || !proposal) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  }

  const venue = proposal.venues as { name: string; logo_url: string | null; pass_service_fee: boolean; brand_logo_url?: string; brand_tagline?: string; brand_email?: string; brand_phone?: string; brand_website?: string; brand_color?: string; brand_address?: string; brand_city?: string; brand_state?: string; brand_zip?: string; brand_footer_note?: string } | null;
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
    venue_logo_url: venue?.brand_logo_url || venue?.logo_url || null,
    venue_brand: {
      color:       venue?.brand_color || '#293745',
      tagline:     venue?.brand_tagline || null,
      email:       venue?.brand_email || null,
      phone:       venue?.brand_phone || null,
      website:     venue?.brand_website || null,
      address:     venue?.brand_address || null,
      city:        venue?.brand_city || null,
      state:       venue?.brand_state || null,
      zip:         venue?.brand_zip || null,
      footer_note: venue?.brand_footer_note || null,
    },
    schedule: scheduleData,
    subscription: subscriptionData,
    service_fee: venue?.pass_service_fee === true,
  });
}
