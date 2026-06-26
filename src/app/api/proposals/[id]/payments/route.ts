import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getMemberName } from '@/lib/auth-helpers';
import {
  recomputeProposalPaymentStatus,
  sendManualPaymentReceipt,
  type ManualPaymentMethod,
} from '@/lib/proposal-payments';

export const dynamic = 'force-dynamic';

const VALID_METHODS: ManualPaymentMethod[] = ['cash', 'check', 'other'];

/** List manual (cash/check) payments recorded against a proposal/invoice. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const venueId = (await cookies()).get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const { data: proposal } = await supabaseAdmin
    .from('proposals')
    .select('id, price')
    .eq('id', id)
    .eq('venue_id', venueId)
    .single();

  if (!proposal) return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });

  const { data, error } = await supabaseAdmin
    .from('proposal_payments')
    .select('*')
    .eq('proposal_id', id)
    .eq('venue_id', venueId)
    .order('paid_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const payments = data ?? [];
  const totalPaidCents = payments.reduce((acc, p) => acc + (Number(p.amount_cents) || 0), 0);
  const priceCents = Number(proposal.price) || 0;

  return NextResponse.json({
    payments,
    total_paid_cents: totalPaidCents,
    price_cents: priceCents,
    balance_cents: Math.max(priceCents - totalPaidCents, 0),
  });
}

/** Record a manual cash/check payment against a proposal/invoice. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const venueId = (await cookies()).get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const amountCents =
    typeof body.amountCents === 'number' && Number.isFinite(body.amountCents)
      ? Math.round(body.amountCents)
      : 0;
  const method: ManualPaymentMethod = VALID_METHODS.includes(body.method) ? body.method : 'cash';
  const checkNumber =
    method === 'check' && typeof body.checkNumber === 'string' && body.checkNumber.trim()
      ? body.checkNumber.trim()
      : null;
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;
  const sendReceipt = body.sendReceipt !== false;

  if (amountCents <= 0) {
    return NextResponse.json({ error: 'A payment amount greater than $0 is required.' }, { status: 400 });
  }

  const { data: proposal, error: fetchError } = await supabaseAdmin
    .from('proposals')
    .select('id, venue_id, price, public_token, customer_name, customer_email, status')
    .eq('id', id)
    .eq('venue_id', venueId)
    .single();

  if (fetchError || !proposal) {
    return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
  }

  const recordedBy = await getMemberName();

  const { data: payment, error: insertError } = await supabaseAdmin
    .from('proposal_payments')
    .insert({
      proposal_id: id,
      venue_id: venueId,
      amount_cents: amountCents,
      method,
      check_number: checkNumber,
      note,
      recorded_by: recordedBy,
      paid_at: typeof body.paidAt === 'string' && body.paidAt ? body.paidAt : new Date().toISOString(),
    })
    .select()
    .single();

  if (insertError) {
    if (insertError.code === '42P01') {
      return NextResponse.json(
        { error: 'Manual payments are not set up yet. Run migration 154.' },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const recompute = await recomputeProposalPaymentStatus(id);
  const balanceCents = recompute?.balanceCents ?? Math.max((Number(proposal.price) || 0) - amountCents, 0);

  if (sendReceipt && proposal.customer_email) {
    await sendManualPaymentReceipt({
      venueId,
      customerEmail: proposal.customer_email,
      customerName: proposal.customer_name,
      publicToken: proposal.public_token,
      amountCents,
      method,
      checkNumber,
      balanceCents,
    });
  }

  return NextResponse.json({
    payment,
    status: recompute?.status ?? proposal.status,
    total_paid_cents: recompute?.totalPaidCents ?? amountCents,
    balance_cents: balanceCents,
    price_cents: recompute?.priceCents ?? (Number(proposal.price) || 0),
  }, { status: 201 });
}
