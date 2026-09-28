/**
 * Admin: move venues' software subscriptions from LunarPay to the owner's
 * Stripe account (lib/stripe/lunarpay-migration.ts).
 *
 * GET  → every venue still on LunarPay, with what a move would do.
 * POST { venueId, customerId?, dryRun? } → preview (dryRun) or move one venue.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { isStripeConfigured } from '@/lib/stripe/client';
import { listLunarPaySubscribers, migrateVenueFromLunarPay, previewMigration } from '@/lib/stripe/lunarpay-migration';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  if (!(await verifyAdminCookie())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isStripeConfigured()) return NextResponse.json({ error: 'Stripe is not configured (STRIPE_SECRET_KEY).' }, { status: 503 });
  try {
    return NextResponse.json({ venues: await listLunarPaySubscribers() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not load LunarPay subscribers' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!(await verifyAdminCookie())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isStripeConfigured()) return NextResponse.json({ error: 'Stripe is not configured (STRIPE_SECRET_KEY).' }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as { venueId?: string; customerId?: string; dryRun?: boolean };
  const venueId = String(body.venueId ?? '').trim();
  if (!venueId) return NextResponse.json({ error: 'venueId is required' }, { status: 400 });
  const customerId = body.customerId?.trim() || null;
  if (customerId && !customerId.startsWith('cus_')) {
    return NextResponse.json({ error: 'customerId must be a Stripe customer id (cus_…)' }, { status: 400 });
  }
  try {
    if (body.dryRun) return NextResponse.json({ preview: await previewMigration(venueId, { customerId }) });
    const moved = await migrateVenueFromLunarPay(venueId, { customerId });
    return NextResponse.json({ ok: true, ...moved });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Move failed' }, { status: 400 });
  }
}
