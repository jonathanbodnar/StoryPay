import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { syncPaymentRemindersForProposal } from '@/lib/payment-reminders';
import { notifyOwner, formatAmount } from '@/lib/owner-notifications';
import { dispatchIntegrationEvent } from '@/lib/integration-events';
import { applySystemTagByEmail, ensureSystemTagsForVenue } from '@/lib/system-tags';

/**
 * Default ESIGN/UETA consent disclosure shown on the public proposal
 * page. Surfaced in the API too so we always have a single canonical
 * string of record to store on each signature.
 */
export const ESIGN_CONSENT_TEXT =
  'By signing electronically below, I consent to do business electronically with the venue, ' +
  'agree that this electronic signature is the legal equivalent of a handwritten signature, ' +
  'and accept the terms outlined in this proposal. I understand I can request a paper copy ' +
  'or withdraw electronic consent by contacting the venue.';

function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip')?.trim()
    || request.headers.get('cf-connecting-ip')?.trim()
    || 'unknown';
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const body = await request.json() as {
    signatureData?: unknown;
    consentAccepted?: boolean;
    consentText?: string;
  };
  const { signatureData, consentAccepted, consentText } = body;

  if (!signatureData) {
    return NextResponse.json({ error: 'Signature data required' }, { status: 400 });
  }
  if (consentAccepted !== true) {
    // ESIGN/UETA requires explicit affirmative consent. Without it, the
    // signature would not be enforceable, so we refuse to record one.
    return NextResponse.json(
      { error: 'You must agree to sign electronically to continue.' },
      { status: 400 },
    );
  }

  const { data: proposal, error } = await supabaseAdmin
    .from('proposals')
    .select('id, status, venue_id, customer_name, customer_email, customer_phone, price, payment_type, content')
    .eq('public_token', token)
    .single();

  if (error || !proposal) {
    console.warn('[proposal-sign] proposal not found for token', token);
    return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
  }

  console.log('[proposal-sign] entry', { id: proposal.id, status: proposal.status, venueId: proposal.venue_id });

  if (proposal.status !== 'sent' && proposal.status !== 'opened') {
    // IMPORTANT: if the proposal is already 'signed' or 'paid', we skip the
    // signature insert AND the proposal_signed notification. This is by
    // design — re-signing the same proposal shouldn't re-fire the email.
    // Logged here to make it obvious in the Vercel logs why nothing was sent.
    console.warn('[proposal-sign] skipped — already in state:', proposal.status);
    return NextResponse.json({ error: 'Proposal cannot be signed in current state' }, { status: 400 });
  }

  // Compute a tamper-evident hash of WHAT was signed so we can prove the
  // contract content didn't change after signing. Includes the rendered
  // content, the price, the payment type, and the customer identity.
  const hashInput = JSON.stringify({
    content:        (proposal.content as string | null) ?? '',
    price:          (proposal.price as number | null) ?? 0,
    payment_type:   (proposal.payment_type as string | null) ?? 'full',
    customer_name:  (proposal.customer_name as string | null) ?? '',
    customer_email: (proposal.customer_email as string | null) ?? '',
  });
  const signedContentHash = crypto.createHash('sha256').update(hashInput).digest('hex');

  const signerIp        = getClientIp(request);
  const signerUserAgent = request.headers.get('user-agent') ?? '';
  const recordedConsent = (typeof consentText === 'string' && consentText.trim())
    ? consentText.trim()
    : ESIGN_CONSENT_TEXT;
  const signedAt = new Date().toISOString();

  // Audit-trail columns are best-effort: if migration 124 hasn't run
  // yet, we drop them and persist just the legacy signature fields.
  const auditUpdate = {
    status: 'signed',
    signature_data: signatureData,
    signed_at: signedAt,
    signer_ip: signerIp,
    signer_user_agent: signerUserAgent,
    signer_consent_text: recordedConsent,
    signer_consent_accepted: true,
    signed_content_hash: signedContentHash,
    signed_payment_type: (proposal.payment_type as string | null) ?? null,
    signed_price: (proposal.price as number | null) ?? null,
  };

  let updateError: { message: string } | null = null;
  {
    const { error: e } = await supabaseAdmin
      .from('proposals')
      .update(auditUpdate)
      .eq('id', proposal.id);
    updateError = e ? { message: e.message } : null;
  }
  if (updateError && /column .* does not exist|Could not find the .* column/i.test(updateError.message)) {
    console.warn('[proposal-sign] audit columns missing — falling back. Run migration 124.');
    const { error: e2 } = await supabaseAdmin
      .from('proposals')
      .update({
        status: 'signed',
        signature_data: signatureData,
        signed_at: signedAt,
      })
      .eq('id', proposal.id);
    updateError = e2 ? { message: e2.message } : null;
  }

  if (updateError) {
    return NextResponse.json({ error: 'Failed to save signature' }, { status: 500 });
  }

  void syncPaymentRemindersForProposal(proposal.id);

  // Notify the venue owner that a proposal was signed (gated by toggles).
  //
  // We `await` notifyOwner here (rather than fire-and-forget) because in
  // serverless runtimes (Vercel/Railway) any unfinished promises after the
  // response is returned can be suspended/cancelled — which was silently
  // dropping the proposal_signed email. notifyOwner internally swallows all
  // errors, so awaiting is safe and never blocks the success response from
  // shipping.
  if (proposal.venue_id) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.storypay.io';
    await notifyOwner({
      venueId: proposal.venue_id as string,
      scenario: 'proposal_signed',
      vars: {
        customer_name: (proposal.customer_name as string | null) || 'Customer',
        amount:        formatAmount(proposal.price as number | null),
      },
      actionUrl: `${appUrl}/dashboard/payments/proposals`,
    });

    // Fan out to Zapier / external integrations (also awaited for the same
    // serverless-cancellation reason above).
    await dispatchIntegrationEvent(proposal.venue_id as string, 'proposal.signed', {
      proposal: {
        id: proposal.id,
        customer_name: (proposal.customer_name as string | null) || '',
        customer_email: (proposal.customer_email as string | null) || '',
        customer_phone: (proposal.customer_phone as string | null) || '',
        price_cents: (proposal.price as number | null) ?? 0,
        price_dollars: formatAmount(proposal.price as number | null),
        payment_type: (proposal.payment_type as string | null) || 'full',
        signed_at: new Date().toISOString(),
      },
    }).catch(err => console.error('[proposal-sign] dispatchIntegrationEvent', err));

    // Apply proposal_signed + contract_signed system tags (fire-and-forget)
    const signerEmail = (proposal.customer_email as string | null)?.trim();
    if (signerEmail) {
      ensureSystemTagsForVenue(proposal.venue_id as string)
        .then(() => Promise.all([
          applySystemTagByEmail(proposal.venue_id as string, signerEmail, 'proposal_signed'),
          applySystemTagByEmail(proposal.venue_id as string, signerEmail, 'contract_signed'),
        ]))
        .catch(() => {});
    }
  }

  return NextResponse.json({ success: true });
}
