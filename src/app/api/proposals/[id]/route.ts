import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { sendClientDocument } from '@/lib/client-document-send';
import { syncPaymentRemindersForProposal } from '@/lib/payment-reminders';
import { paymentTermsError, termsFingerprint } from '@/lib/payment-plan';
import { sumManualPayments } from '@/lib/proposal-payments';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;

  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  const { data: proposal, error } = await supabaseAdmin
    .from('proposals')
    .select('*')
    .eq('id', id)
    .eq('venue_id', venueId)
    .single();

  if (error || !proposal) {
    return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
  }

  return NextResponse.json(proposal);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;

  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();

  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('proposals')
    .select('*')
    .eq('id', id)
    .eq('venue_id', venueId)
    .single();

  if (fetchError || !existing) {
    return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
  }

  const {
    customerName, customerEmail, customerPhone,
    price, paymentType, paymentConfig,
    acceptAch,
    sendNow,
  } = body;

  if (sendNow && existing.status === 'paid') {
    return NextResponse.json(
      { error: 'Paid proposals cannot be resent' },
      { status: 409 }
    );
  }

  // Payment terms after this update.
  const nextPrice = price !== undefined ? price : existing.price;
  const nextType = paymentType !== undefined ? paymentType : existing.payment_type;
  const nextConfig = paymentConfig !== undefined ? paymentConfig : existing.payment_config;
  const termsChanged =
    termsFingerprint(nextPrice, nextType, nextConfig) !==
    termsFingerprint(existing.price, existing.payment_type, existing.payment_config);

  // Locked once money has changed hands: the balance and the automatic
  // payments are worked out from them.
  if (termsChanged) {
    const moneyMoved =
      !!existing.paid_at ||
      !!existing.payment_processing_at ||
      ['paid', 'partially_paid', 'refunded', 'partial_refund'].includes(existing.status) ||
      (await sumManualPayments(id)) > 0;
    if (moneyMoved) {
      return NextResponse.json(
        { error: 'The price and payment plan can’t change after a payment has been made.' },
        { status: 409 }
      );
    }
  }
  // Checked when a draft is sent, or when terms change on one that's out.
  if ((sendNow && existing.status === 'draft') || (termsChanged && existing.status !== 'draft')) {
    const termsError = paymentTermsError({
      priceCents: Math.round(Number(nextPrice) || 0),
      paymentType: nextType,
      paymentConfig: nextConfig,
      collectManually: existing.collect_manually === true,
    });
    if (termsError) return NextResponse.json({ error: termsError }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {};

  if (customerName !== undefined) updateData.customer_name = customerName;
  if (customerEmail !== undefined) updateData.customer_email = customerEmail;
  if (customerPhone !== undefined) updateData.customer_phone = customerPhone || null;
  if (price !== undefined) updateData.price = price;
  if (paymentType !== undefined) updateData.payment_type = paymentType;
  if (paymentConfig !== undefined) updateData.payment_config = paymentConfig;
  if (acceptAch !== undefined) updateData.accept_ach = acceptAch;

  if (sendNow) {
    const name = customerName || existing.customer_name;
    const email = customerEmail || existing.customer_email;
    const phone = customerPhone ?? existing.customer_phone;
    const finalPrice = price ?? existing.price;

    if (!name || !email) {
      return NextResponse.json(
        { error: 'Customer name and email are required to send' },
        { status: 400 }
      );
    }
    if (!finalPrice || finalPrice <= 0) {
      return NextResponse.json({ error: 'A valid price is required to send' }, { status: 400 });
    }

    const isInvoice = existing.is_invoice === true;
    if (existing.status === 'draft') {
      // First send. An invoice has no signing step (same as /api/invoices).
      const nowIso = new Date().toISOString();
      updateData.status = isInvoice ? 'signed' : 'sent';
      updateData.sent_at = nowIso;
      if (isInvoice) updateData.signed_at = nowIso;
    }
    // A resend keeps the status as it is: it never un-signs a signed proposal.
    updateData.customer_name = name;
    updateData.customer_email = email;
    updateData.customer_phone = phone || null;

    // One branded email (through the venue's CRM when it's connected) and a text.
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    const cfg = (nextConfig ?? {}) as { due_date?: unknown };
    const due = typeof cfg.due_date === 'string' ? cfg.due_date.slice(0, 10) : '';
    await sendClientDocument({
      venueId,
      kind: isInvoice ? 'invoice' : 'proposal',
      url: `${appUrl}/proposal/${existing.public_token}`,
      customerName: name,
      customerEmail: email,
      customerPhone: phone,
      vars: {
        amount: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((Number(finalPrice) || 0) / 100),
        invoice_number: String(existing.public_token || '').slice(0, 8).toUpperCase(),
        due_date: /^\d{4}-\d{2}-\d{2}$/.test(due)
          ? new Date(`${due}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
          : '',
      },
    });
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('proposals')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  void syncPaymentRemindersForProposal(id);

  return NextResponse.json(updated);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies();
  const venueId = cookieStore.get('venue_id')?.value;

  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  const { data: existing } = await supabaseAdmin
    .from('proposals')
    .select('status')
    .eq('id', id)
    .eq('venue_id', venueId)
    .single();

  if (!existing) {
    return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
  }

  if (existing.status !== 'draft') {
    return NextResponse.json({ error: 'Only drafts can be deleted' }, { status: 409 });
  }

  const { error } = await supabaseAdmin
    .from('proposals')
    .delete()
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: true });
}
