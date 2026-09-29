/** POST /api/card-update/[token]/stripe-save { setupIntentId } → use the new card for the remaining installments. */
import { NextResponse } from 'next/server';
import { saveCardUpdate } from '@/lib/stripe/card-update';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = (await request.json().catch(() => ({}))) as { setupIntentId?: string };
  if (!body.setupIntentId?.startsWith('seti_')) return NextResponse.json({ error: 'Missing card details.' }, { status: 400 });
  try {
    const result = await saveCardUpdate(token, body.setupIntentId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[card-update/stripe-save]', e);
    return NextResponse.json({ error: 'Your card couldn’t be saved. Please try again.' }, { status: 500 });
  }
}
