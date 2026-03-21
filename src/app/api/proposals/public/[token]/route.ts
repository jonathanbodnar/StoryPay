import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const { data: proposal, error } = await supabaseAdmin
    .from('proposals')
    .select('*, venues(name, logo_url)')
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

  const venue = proposal.venues as { name: string; logo_url: string | null } | null;

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
    venue_logo_url: venue?.logo_url ?? null,
    proposal_id: proposal.id,
  });
}
