import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { verifyDirectoryPlatformCheckoutAndSubscribe } from '@/lib/platform-directory-billing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!user.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { session_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const sessionId = body.session_id?.trim();
  if (!sessionId) {
    return NextResponse.json({ error: 'session_id required' }, { status: 400 });
  }

  try {
    const { subscriptionId } = await verifyDirectoryPlatformCheckoutAndSubscribe(user.venueId, sessionId);
    return NextResponse.json({ ok: true, subscription_id: String(subscriptionId) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Verification failed';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
