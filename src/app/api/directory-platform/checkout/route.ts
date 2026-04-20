import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import {
  createDirectoryPlatformCheckoutSession,
  isPlatformDirectoryBillingConfigured,
} from '@/lib/platform-directory-billing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!user.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!isPlatformDirectoryBillingConfigured()) {
    return NextResponse.json(
      { error: 'Directory subscription billing is not configured on the server.' },
      { status: 503 },
    );
  }

  try {
    const { url } = await createDirectoryPlatformCheckoutSession(user.venueId);
    return NextResponse.json({ url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to start checkout';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
