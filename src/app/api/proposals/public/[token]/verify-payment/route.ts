import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getCheckoutSession } from '@/lib/lunarpay';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const { session_id } = await request.json();

  if (!session_id) {
    return NextResponse.json({ error: 'session_id required' }, { status: 400 });
  }

  const { data: proposal, error } = await supabaseAdmin
    .from('proposals')
    .select('id, venue_id, status')
    .eq('public_token', token)
    .single();

  if (error || !proposal) {
    return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
  }

  if (proposal.status === 'paid') {
    return NextResponse.json({ success: true, already_paid: true });
  }

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('lunarpay_secret_key')
    .eq('id', proposal.venue_id)
    .single();

  if (!venue?.lunarpay_secret_key) {
    return NextResponse.json({ error: 'Venue payment not configured' }, { status: 400 });
  }

  try {
    const result = await getCheckoutSession(venue.lunarpay_secret_key, session_id);
    const session = result.data || result;

    if (session.status !== 'completed') {
      return NextResponse.json(
        { error: 'Payment not completed', status: session.status },
        { status: 400 }
      );
    }

    await supabaseAdmin
      .from('proposals')
      .update({
        status: 'paid',
        paid_at: session.paid_at || new Date().toISOString(),
        checkout_session_id: session_id,
        transaction_id: session.transaction_id || null,
      })
      .eq('id', proposal.id);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Verify payment error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to verify payment' },
      { status: 500 }
    );
  }
}
