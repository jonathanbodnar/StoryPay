import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { createIntention } from '@/lib/lunarpay';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const { data: proposal, error } = await supabaseAdmin
    .from('proposals')
    .select('id, venue_id, status, price')
    .eq('public_token', token)
    .single();

  if (error || !proposal) {
    return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
  }

  if (proposal.status !== 'signed') {
    return NextResponse.json({ error: 'Proposal must be signed before payment' }, { status: 400 });
  }

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('lunarpay_publishable_key')
    .eq('id', proposal.venue_id)
    .single();

  if (!venue?.lunarpay_publishable_key) {
    return NextResponse.json({ error: 'Venue payment not configured' }, { status: 400 });
  }

  try {
    const intentionResult = await createIntention(venue.lunarpay_publishable_key, proposal.price || undefined);
    const intention = intentionResult.data || intentionResult;

    return NextResponse.json({
      clientToken: intention.clientToken,
      environment: intention.environment ?? 'production',
    });
  } catch (err) {
    console.error('Payment intent error:', err);
    return NextResponse.json({ error: 'Failed to create payment intent' }, { status: 500 });
  }
}
