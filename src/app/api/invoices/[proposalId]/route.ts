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
    .select('*, venues(name, logo_url, service_fee_rate, brand_logo_url, brand_tagline, brand_email, brand_phone, brand_website, brand_color, brand_address, brand_city, brand_state, brand_zip, brand_footer_note)')
    .eq('id', proposalId)
    .single();

  if (error || !proposal) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  }

  const venue = proposal.venues as { name: string; logo_url: string | null; service_fee_rate: number; brand_logo_url?: string; brand_tagline?: string; brand_email?: string; brand_phone?: string; brand_website?: string; brand_color?: string; brand_address?: string; brand_city?: string; brand_state?: string; brand_zip?: string; brand_footer_note?: string } | null;

  // Pull the recorded payment ledger (manual + online) so the couple can see
  // "all my payments" with a running balance. Tolerant of the table not
  // existing yet (pre-migration 155).
  let ledger: Array<Record<string, unknown>> = [];
  try {
    const { data: pays } = await supabaseAdmin
      .from('proposal_payments')
      .select('id, payment_number, amount_cents, refunded_cents, refunded_at, method, source, check_number, note, paid_at')
      .eq('proposal_id', proposalId)
      .order('paid_at', { ascending: true });
    if (pays) ledger = pays as Array<Record<string, unknown>>;
  } catch { /* ledger unavailable — ignore */ }

  const priceCents = Number(proposal.price) || 0;
  // A refund is a credit: the balance counts everything paid (before refunds),
  // and "paid" is what the couple has paid net of refunds.
  const grossPaidCents = ledger.reduce((acc, p) => acc + (Number(p.amount_cents) || 0), 0);
  const refundedCents = ledger.reduce((acc, p) => acc + (Number(p.refunded_cents) || 0), 0);
  const totalPaidCents = grossPaidCents - refundedCents;
  const balanceCents = Math.max(priceCents - grossPaidCents, 0);
  let scheduleData = null;
  let subscriptionData = null;

  // Installment plan on the venue's Stripe account: the schedule comes from
  // StoryVenue's own records (first payment + automatically charged ones).
  if (proposal.payment_provider === 'stripe' && proposal.payment_type === 'installment') {
    const cfg = ((proposal.payment_config as { installments?: Array<{ amount: number; date: string }> } | null)?.installments ?? []);
    if (cfg.length) {
      const { data: rows } = await supabaseAdmin
        .from('proposal_installments')
        .select('installment_number, amount_cents, due_date, status, canceled_reason')
        .eq('proposal_id', proposal.id)
        .order('installment_number', { ascending: true });
      const label: Record<string, string> = { scheduled: 'scheduled', processing: 'pending', paid: 'paid', failed: 'failed', canceled: 'canceled' };
      // A payment covered by a check or cash payment isn't "canceled" to the couple.
      const rowStatus = (r: { status: string; canceled_reason?: string | null }) =>
        r.status === 'canceled' && r.canceled_reason === 'covered' ? 'covered' : label[r.status] ?? r.status;
      const first = {
        amount: cfg[0].amount,
        scheduledDate: (proposal.paid_at as string | null) ?? cfg[0].date,
        status: proposal.status === 'paid' ? 'paid' : proposal.payment_processing_at ? 'pending' : 'scheduled',
      };
      const later = (rows ?? []).length
        ? (rows as Array<{ amount_cents: number; due_date: string; status: string; canceled_reason: string | null }>).map((r) => ({ amount: r.amount_cents, scheduledDate: r.due_date, status: rowStatus(r) }))
        : cfg.slice(1).map((c) => ({ amount: c.amount, scheduledDate: c.date, status: 'scheduled' }));
      scheduleData = { payments: [first, ...later] };
    }
  } else if (proposal.payment_schedule_id || proposal.subscription_id) {
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
    proposal_number: proposal.proposal_number ?? null,
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
    payments: ledger,
    total_paid_cents: totalPaidCents,
    refunded_cents: refundedCents,
    balance_cents: balanceCents,
    venue_name: venue?.name ?? '',
    venue_logo_url: venue?.brand_logo_url || venue?.logo_url || null,
    venue_brand: {
      color:       venue?.brand_color || '#1b1b1b',
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
    service_fee_rate: Number(venue?.service_fee_rate ?? 0),
  });
}
