export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse, type NextRequest } from 'next/server';
import { authenticateApiV1, corsPreflight, CORS_HEADERS } from '@/lib/api-v1-auth';
import { supabaseAdmin } from '@/lib/supabase';

export async function OPTIONS() { return corsPreflight(); }

/**
 * Polling trigger for "Payment Received".
 * Returns proposals that have been paid, ordered by paid_at desc.
 * Each row is shaped like a "payment" event for Zapier convenience.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateApiV1(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 100);

  const { data, error } = await supabaseAdmin
    .from('proposals')
    .select('id, customer_name, customer_email, customer_phone, price, payment_type, status, transaction_id, charge_id, paid_at')
    .eq('venue_id', auth.venueId)
    .in('status', ['paid'])
    .not('paid_at', 'is', null)
    .order('paid_at', { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS_HEADERS });

  return NextResponse.json(
    {
      payments: (data || []).map((row) => {
        const p = row as { id: string; customer_name: string | null; customer_email: string | null; customer_phone: string | null; price: number | null; payment_type: string | null; status: string; transaction_id: string | null; charge_id: string | null; paid_at: string | null };
        return {
          id: `pay_${p.id}_${p.paid_at || ''}`,
          proposal_id: p.id,
          customer_name: p.customer_name || '',
          customer_email: p.customer_email || '',
          customer_phone: p.customer_phone || '',
          amount_cents: p.price ?? 0,
          amount_dollars: ((p.price ?? 0) / 100).toFixed(2),
          payment_type: p.payment_type || 'full',
          transaction_id: p.transaction_id || p.charge_id || null,
          paid_at: p.paid_at,
        };
      }),
    },
    { headers: CORS_HEADERS },
  );
}
