import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { changeVenuePlan } from '@/lib/venue-billing';
import { isPlatformDirectoryBillingConfigured } from '@/lib/platform-directory-billing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!user.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: { plan_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const planId = body.plan_id?.trim();
  if (!planId) return NextResponse.json({ error: 'plan_id is required' }, { status: 400 });

  if (!isPlatformDirectoryBillingConfigured()) {
    return NextResponse.json(
      { error: 'Directory subscription billing is not configured on the server.' },
      { status: 503 },
    );
  }

  try {
    const result = await changeVenuePlan(user.venueId, planId);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Plan change failed';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
