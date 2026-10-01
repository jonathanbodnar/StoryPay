/**
 * The hourly payment-plan run (lib/in-app-scheduler.ts, and GET
 * /api/cron/installments on demand):
 *   • charges installments that are due on venues' Stripe accounts (claimed
 *     row by row, so overlapping runs never charge twice)
 *   • emails couples 3 days before each automatic payment
 *   • re-reads Stripe accounts still in signup or review, so a venue Stripe
 *     approves later starts taking payments without visiting the app
 */

import { supabaseAdmin } from '@/lib/supabase';
import { syncConnectedAccount } from '@/lib/stripe/connect';
import { chargeDueInstallments, sendUpcomingPaymentHeadsUps } from '@/lib/stripe/proposal-payments';

export async function runInstallmentsCron() {
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
  return { installments, headsUps, accountsSynced };
}
