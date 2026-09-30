/**
 * GET /api/cron/installments  (Bearer MARKETING_CRON_SECRET / CRON_SECRET)
 *
 * Runs hourly (.github/workflows/installments-cron.yml):
 *   • charges installments that are due on venues' Stripe accounts (claimed
 *     row by row, so overlapping runs never charge twice)
 *   • emails couples 3 days before each automatic payment
 *   • re-reads Stripe accounts still in signup or review, so a venue Stripe
 *     approves later starts taking payments without visiting the app
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { isStripeConfigured } from '@/lib/stripe/client';
import { syncConnectedAccount } from '@/lib/stripe/connect';
import { chargeDueInstallments, sendUpcomingPaymentHeadsUps } from '@/lib/stripe/proposal-payments';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function authorize(request: NextRequest): boolean {
  const secret = process.env.MARKETING_CRON_SECRET || process.env.CRON_SECRET || '';
  if (!secret) return process.env.NODE_ENV !== 'production';
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  return token === secret || request.nextUrl.searchParams.get('secret') === secret;
}

export async function GET(request: NextRequest) {
  if (!authorize(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isStripeConfigured()) return NextResponse.json({ ok: true, result: { skipped: 'stripe not configured' } });

  try {
    const installments = await chargeDueInstallments();
    // Couples get an email 3 days before each automatic payment.
    const headsUps = await sendUpcomingPaymentHeadsUps().catch((e) => {
      console.error('[cron/installments] heads-ups failed', e);
      return null;
    });

    let accountsSynced = 0;
    const { data } = await supabaseAdmin
      .from('venues')
      .select('id')
      .not('stripe_account_id', 'is', null)
      .in('stripe_account_status', ['onboarding', 'pending'])
      .limit(50);
    for (const row of (data ?? []) as Array<{ id: string }>) {
      try {
        await syncConnectedAccount(row.id);
        accountsSynced++;
      } catch (e) {
        console.warn('[cron/installments] account sync failed', row.id, e instanceof Error ? e.message : e);
      }
    }
    return NextResponse.json({ ok: true, result: { installments, headsUps, accountsSynced } });
  } catch (e) {
    console.error('[cron/installments]', e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
