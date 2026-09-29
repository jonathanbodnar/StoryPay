/** POST /api/card-update/[token]/stripe-setup → a SetupIntent for the new card (venue's Stripe account). */
import { NextResponse } from 'next/server';
import { createCardUpdateSetup } from '@/lib/stripe/card-update';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const setup = await createCardUpdateSetup(token);
    if (!setup) return NextResponse.json({ error: 'This link is no longer valid.' }, { status: 404 });
    return NextResponse.json(setup);
  } catch (e) {
    console.error('[card-update/stripe-setup]', e);
    return NextResponse.json({ error: 'Could not load the card form. Please try again.' }, { status: 500 });
  }
}
