import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { notifyOwner } from '@/lib/owner-notifications';
import { applySystemTagByEmail, ensureSystemTagsForVenue } from '@/lib/system-tags';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const { data: proposal, error } = await supabaseAdmin
    .from('proposals')
    .select('*, venues(name, logo_url, service_fee_rate, brand_logo_url, brand_tagline, brand_email, brand_phone, brand_website, brand_color, brand_address, brand_city, brand_state, brand_zip, brand_footer_note)')
    .eq('public_token', token)
    .single();

  if (error || !proposal) {
    return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
  }

  console.log('[proposal-public-get] entry', { id: proposal.id, status: proposal.status, venueId: proposal.venue_id });

  if (proposal.status === 'sent') {
    await supabaseAdmin
      .from('proposals')
      .update({ status: 'opened', opened_at: new Date().toISOString() })
      .eq('id', proposal.id);
    proposal.status = 'opened';
    proposal.opened_at = new Date().toISOString();

    // Notify the venue owner once, on first open.
    //
    // Awaited (not fire-and-forget) because in serverless runtimes
    // unfinished promises can be cancelled when the response returns,
    // which was silently dropping the document_viewed email. notifyOwner
    // swallows its own errors, so this never blocks the response.
    if (proposal.venue_id) {
      console.log('[proposal-public-get] firing document_viewed for venue', proposal.venue_id);
      await notifyOwner({
        venueId: proposal.venue_id as string,
        scenario: 'document_viewed',
        vars: {
          customer_name:  String(proposal.customer_name || 'Your customer'),
          customer_email: String(proposal.customer_email || ''),
        },
      });

      // Apply proposal_viewed or invoice_viewed system tag (fire-and-forget)
      if (proposal.customer_email) {
        const isInvoice = proposal.is_invoice === true;
        ensureSystemTagsForVenue(proposal.venue_id as string)
          .then(() => applySystemTagByEmail(
            proposal.venue_id as string,
            String(proposal.customer_email),
            isInvoice ? 'invoice_viewed' : 'proposal_viewed',
          ))
          .catch(() => {});
      }
    }
  } else {
    // Already opened — document_viewed was (or should have been) fired previously.
    // We don't re-fire on subsequent views to avoid spamming the owner.
    console.log('[proposal-public-get] not firing document_viewed — proposal already in state:', proposal.status);
  }

  const venue = proposal.venues as { name: string; logo_url: string | null; service_fee_rate: number; brand_logo_url?: string; brand_tagline?: string; brand_email?: string; brand_phone?: string; brand_website?: string; brand_color?: string; brand_address?: string; brand_city?: string; brand_state?: string; brand_zip?: string; brand_footer_note?: string } | null;

  // Invoices (created via /api/invoices, marked is_invoice) have no signing
  // step. A proposal always does, even when its contract was written freeform
  // or with AI instead of from a template.
  const isInvoice = proposal.is_invoice === true;

  // A payment plan under way: what's left and the next automatic payment.
  let balanceCents: number | null = null;
  let nextPayment: { amount_cents: number; due_date: string } | null = null;
  if (proposal.payment_type === 'installment' && ['paid', 'partially_paid', 'partial_refund'].includes(String(proposal.status))) {
    const [{ data: ledger }, { data: upcoming }] = await Promise.all([
      supabaseAdmin.from('proposal_payments').select('amount_cents').eq('proposal_id', proposal.id),
      supabaseAdmin
        .from('proposal_installments')
        .select('amount_cents, due_date')
        .eq('proposal_id', proposal.id)
        .in('status', ['scheduled', 'failed'])
        .order('due_date', { ascending: true })
        .limit(1),
    ]);
    const paid = ((ledger ?? []) as Array<{ amount_cents: number }>).reduce((s, r) => s + (Number(r.amount_cents) || 0), 0);
    balanceCents = Math.max((Number(proposal.price) || 0) - paid, 0);
    const n = (upcoming ?? [])[0] as { amount_cents: number; due_date: string } | undefined;
    if (n && balanceCents > 0) nextPayment = { amount_cents: n.amount_cents, due_date: String(n.due_date).slice(0, 10) };
  }

  return NextResponse.json({
    customer_name: proposal.customer_name,
    customer_email: proposal.customer_email,
    proposal_number: proposal.proposal_number ?? null,
    content: proposal.content,
    price: proposal.price,
    payment_type: proposal.payment_type,
    payment_config: proposal.payment_config,
    status: proposal.status,
    signature_fields: proposal.signature_fields,
    signed_at: proposal.signed_at,
    paid_at: proposal.paid_at,
    is_invoice: isInvoice,
    collect_manually: proposal.collect_manually === true,
    // A bank payment was submitted and is still clearing (Stripe, 3–5 business days).
    payment_processing: Boolean((proposal as { payment_processing_at?: string | null }).payment_processing_at),
    require_signature: proposal.require_signature !== false,
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
    proposal_id: proposal.id,
    service_fee_rate: Number(venue?.service_fee_rate ?? 0),
    balance_cents: balanceCents,
    next_payment: nextPayment,
  });
}
