import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import {
  startUpdatePaymentMethodCheckout,
  verifyUpdatePaymentMethod,
} from '@/lib/venue-billing';
import { isPlatformDirectoryBillingConfigured } from '@/lib/platform-directory-billing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!user.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (!isPlatformDirectoryBillingConfigured()) {
    return NextResponse.json(
      { error: 'Directory subscription billing is not configured on the server.' },
      { status: 503 },
    );
  }

  let body: { session_id?: string } = {};
  try {
    body = await request.json();
  } catch {
    // Allow empty body to mean "start update flow".
  }

  if (body.session_id && body.session_id.trim().length > 0) {
    try {
      await verifyUpdatePaymentMethod(user.venueId, body.session_id.trim());
      return NextResponse.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Verification failed';
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  }

  try {
    const { url } = await startUpdatePaymentMethodCheckout(user.venueId);
    return NextResponse.json({ url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not start payment update';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
