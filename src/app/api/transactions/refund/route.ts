import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { refundCharge } from '@/lib/lunarpay';

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { proposalId, chargeId, amountCents } = await request.json();

  if (!proposalId) return NextResponse.json({ error: 'proposalId is required' }, { status: 400 });

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('lunarpay_secret_key')
    .eq('id', venueId)
    .single();

  if (!venue?.lunarpay_secret_key) {
    return NextResponse.json({ error: 'LunarPay not configured' }, { status: 400 });
  }

  const { data: proposal } = await supabaseAdmin
    .from('proposals')
    .select('id, status, charge_id, price')
    .eq('id', proposalId)
    .eq('venue_id', venueId)
    .single();

  if (!proposal) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
  if (proposal.status === 'refunded') return NextResponse.json({ error: 'Already refunded' }, { status: 400 });

  const resolvedChargeId = chargeId || proposal.charge_id;
  if (!resolvedChargeId) return NextResponse.json({ error: 'No charge ID found' }, { status: 400 });

  // Validate partial amount
  if (amountCents !== undefined && amountCents !== null) {
    if (amountCents <= 0) return NextResponse.json({ error: 'Refund amount must be greater than $0' }, { status: 400 });
    if (amountCents > (proposal.price ?? 0)) return NextResponse.json({ error: 'Refund amount cannot exceed original charge' }, { status: 400 });
  }

  try {
    const result = await refundCharge(
      venue.lunarpay_secret_key,
      resolvedChargeId,
      amountCents ?? undefined
    );

    // Only mark fully refunded if full amount or no amount specified
    const isFullRefund = !amountCents || amountCents >= (proposal.price ?? 0);
    if (isFullRefund) {
      await supabaseAdmin.from('proposals').update({ status: 'refunded' }).eq('id', proposalId);
    }

    return NextResponse.json({
      success: true,
      refundedAmount: result?.refundedAmount ?? amountCents ?? proposal.price,
      fullRefund: isFullRefund,
    });
  } catch (err) {
    console.error('Refund error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Refund failed' }, { status: 500 });
  }
}
