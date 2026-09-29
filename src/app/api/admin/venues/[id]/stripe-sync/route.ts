/**
 * POST /api/admin/venues/[id]/stripe-sync — re-read a venue's StoryPay™ Stripe
 * account now and store its stage (Venue Management's "Sync" link). Webhooks
 * and the hourly cron normally keep it current; this is the manual check.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { syncConnectedAccount } from '@/lib/stripe/connect';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await verifyAdminCookie())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  try {
    return NextResponse.json(await syncConnectedAccount(id));
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Stripe sync failed';
    console.error('[admin/stripe-sync]', id, msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
