/**
 * POST /api/admin/backfill-lp-resources
 *
 * One-shot backfill: finds paid installment/subscription proposals that are
 * missing payment_schedule_id or subscription_id, queries LP's list APIs,
 * and writes the matching IDs back to the proposals table.
 *
 * Safe to run multiple times — only touches rows where the column is NULL.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { listPaymentSchedules, listSubscriptions } from '@/lib/lunarpay';

export const dynamic = 'force-dynamic';

export async function POST(_request: NextRequest) {
  // Find paid installment/subscription proposals missing their LP resource IDs
  const { data: orphans } = await supabaseAdmin
    .from('proposals')
    .select('id, venue_id, payment_type, customer_lunarpay_id, payment_schedule_id, subscription_id')
    .eq('status', 'paid')
    .in('payment_type', ['installment', 'subscription'])
    .or('payment_schedule_id.is.null,subscription_id.is.null');

  if (!orphans || orphans.length === 0) {
    return NextResponse.json({ message: 'No orphan proposals found', matched: 0 });
  }

  // Group by venue_id so we only query each venue's LP once
  const byVenue = new Map<string, typeof orphans>();
  for (const p of orphans) {
    const key = p.venue_id as string;
    if (!byVenue.has(key)) byVenue.set(key, []);
    byVenue.get(key)!.push(p);
  }

  const results: Array<{ proposalId: string; type: string; matchedId: number | string | null }> = [];

  for (const [venueId, proposals] of byVenue) {
    const { data: venue } = await supabaseAdmin
      .from('venues')
      .select('lunarpay_secret_key')
      .eq('id', venueId)
      .single();

    if (!venue?.lunarpay_secret_key) continue;
    const secret = venue.lunarpay_secret_key;

    // Fetch LP resources once per venue
    let schedules: Record<string, unknown>[] = [];
    let subscriptions: Record<string, unknown>[] = [];

    try {
      const schedRes = await listPaymentSchedules(secret);
      schedules = (Array.isArray(schedRes) ? schedRes : schedRes.data ?? []) as Record<string, unknown>[];
    } catch { /* skip */ }

    try {
      const subRes = await listSubscriptions(secret);
      subscriptions = (Array.isArray(subRes) ? subRes : subRes.data ?? []) as Record<string, unknown>[];
    } catch { /* skip */ }

    for (const p of proposals) {
      const customerId = String(p.customer_lunarpay_id ?? '');

      // LP may return customer_id (snake_case) or customerId (camelCase)
      if (p.payment_type === 'installment' && !p.payment_schedule_id && customerId) {
        const match = schedules.find(
          (s) => String(s.customer_id ?? s.customerId ?? s.donorId ?? s.donor_id) === customerId
        );
        if (match?.id) {
          await supabaseAdmin
            .from('proposals')
            .update({ payment_schedule_id: match.id })
            .eq('id', p.id);
          results.push({ proposalId: p.id, type: 'schedule', matchedId: match.id as number });
        }
      }

      if (p.payment_type === 'subscription' && !p.subscription_id && customerId) {
        const match = subscriptions.find(
          (s) => String(s.customer_id ?? s.customerId ?? s.donorId ?? s.donor_id) === customerId
        );
        if (match?.id) {
          await supabaseAdmin
            .from('proposals')
            .update({ subscription_id: match.id })
            .eq('id', p.id);
          results.push({ proposalId: p.id, type: 'subscription', matchedId: match.id as number });
        }
      }
    }
  }

  return NextResponse.json({
    message: `Backfill complete. ${results.length} proposals updated.`,
    matched: results.length,
    details: results,
  });
}
