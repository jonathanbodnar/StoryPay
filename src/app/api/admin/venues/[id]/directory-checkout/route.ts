import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import {
  createDirectoryPlatformCheckoutSession,
  isPlatformDirectoryBillingConfigured,
} from '@/lib/platform-directory-billing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Generate a hosted checkout URL for a venue (ops: send link to customer). */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await verifyAdminCookie())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: venueId } = await params;
  if (!venueId) {
    return NextResponse.json({ error: 'Missing venue id' }, { status: 400 });
  }

  if (!isPlatformDirectoryBillingConfigured()) {
    return NextResponse.json(
      { error: 'STORYPAY_PLATFORM_LUNARPAY_SECRET_KEY is not set' },
      { status: 503 },
    );
  }

  try {
    const { url } = await createDirectoryPlatformCheckoutSession(venueId);
    return NextResponse.json({ url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
