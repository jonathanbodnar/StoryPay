import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { loadVenueBillingSummary } from '@/lib/venue-billing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const summary = await loadVenueBillingSummary(user.venueId);
    return NextResponse.json(summary);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to load billing summary';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
