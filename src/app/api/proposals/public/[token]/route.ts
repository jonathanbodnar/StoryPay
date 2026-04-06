import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const { data: proposal, error } = await supabaseAdmin
    .from('proposals')
    .select('*, venues(name, logo_url, pass_service_fee, brand_logo_url, brand_tagline, brand_email, brand_phone, brand_website, brand_color, brand_address, brand_city, brand_state, brand_zip, brand_footer_note)')
    .eq('public_token', token)
    .single();

  if (error || !proposal) {
    return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
  }

  if (proposal.status === 'sent') {
    await supabaseAdmin
      .from('proposals')
      .update({ status: 'opened', opened_at: new Date().toISOString() })
      .eq('id', proposal.id);
    proposal.status = 'opened';
    proposal.opened_at = new Date().toISOString();
  }

  const venue = proposal.venues as { name: string; logo_url: string | null; pass_service_fee: boolean; brand_logo_url?: string; brand_tagline?: string; brand_email?: string; brand_phone?: string; brand_website?: string; brand_color?: string; brand_address?: string; brand_city?: string; brand_state?: string; brand_zip?: string; brand_footer_note?: string } | null;

  return NextResponse.json({
    customer_name: proposal.customer_name,
    customer_email: proposal.customer_email,
    content: proposal.content,
    price: proposal.price,
    payment_type: proposal.payment_type,
    payment_config: proposal.payment_config,
    status: proposal.status,
    signature_fields: proposal.signature_fields,
    signed_at: proposal.signed_at,
    paid_at: proposal.paid_at,
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
    proposal_id: proposal.id,
    service_fee: venue?.pass_service_fee === true,
  });
}
