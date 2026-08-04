/**
 * GET  /api/admin/subscriptions/lunarpay-audit
 *   Read-only diff between StoryPay HQ's live LunarPay subscriptions and
 *   venues.directory_subscription_status / directory_subscription_external_id.
 *   Surfaces venues that are actually paying in LunarPay but whose local
 *   status never got flipped (see auditPlatformSubscriptionsAgainstLunarPay
 *   for why that happens).
 *
 * POST /api/admin/subscriptions/lunarpay-audit
 *   Applies a single fix a super-admin confirmed from the GET report.
 *   Body: { venueId, lpSubscriptionId, lpCustomerId, lpAmountCents }
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import {
  auditPlatformSubscriptionsAgainstLunarPay,
  applyLunarPaySubscriptionFix,
} from '@/lib/platform-directory-billing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const result = await auditPlatformSubscriptionsAgainstLunarPay();
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 422 });
  }
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { venueId?: string; lpSubscriptionId?: string; lpCustomerId?: string | null; lpAmountCents?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const venueId = (body.venueId || '').trim();
  const lpSubscriptionId = (body.lpSubscriptionId || '').trim();
  if (!venueId || !lpSubscriptionId) {
    return NextResponse.json({ error: 'venueId and lpSubscriptionId are required' }, { status: 400 });
  }

  await applyLunarPaySubscriptionFix({
    venueId,
    lpSubscriptionId,
    lpCustomerId: body.lpCustomerId ?? null,
    lpAmountCents: typeof body.lpAmountCents === 'number' ? body.lpAmountCents : 0,
  });

  return NextResponse.json({ ok: true });
}
