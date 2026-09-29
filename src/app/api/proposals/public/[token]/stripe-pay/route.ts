/**
 * POST /api/proposals/public/[token]/stripe-pay
 *
 * Confirms the couple's payment on the venue's Stripe account (Stripe Connect).
 *   { confirmationTokenId } → charge the first payment (full, or installment 1)
 *   { paymentIntentId }     → finish after 3D Secure authentication
 * Responds with the outcome: succeeded | processing (bank payment clearing) |
 * requires_action (with the client secret for Stripe.js) | failed.
 */
import { NextResponse } from 'next/server';
import { resumeProposalPayment, startProposalPayment } from '@/lib/stripe/proposal-payments';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let body: { confirmationTokenId?: string; paymentIntentId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    const result = body.paymentIntentId?.startsWith('pi_')
      ? await resumeProposalPayment(token, body.paymentIntentId)
      : body.confirmationTokenId?.startsWith('ctoken_')
        ? await startProposalPayment(token, body.confirmationTokenId)
        : null;
    if (!result) return NextResponse.json({ error: 'Missing payment details.' }, { status: 400 });
    if (result.status === 'failed') return NextResponse.json({ status: 'failed', error: result.error }, { status: 402 });
    return NextResponse.json(result);
  } catch (e) {
    console.error('[stripe-pay]', e);
    return NextResponse.json({ status: 'failed', error: 'Your payment couldn’t be completed. Please try again.' }, { status: 500 });
  }
}
