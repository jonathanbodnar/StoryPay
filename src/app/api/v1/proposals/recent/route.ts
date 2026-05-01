export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse, type NextRequest } from 'next/server';
import { authenticateApiV1, corsPreflight, CORS_HEADERS } from '@/lib/api-v1-auth';
import { supabaseAdmin } from '@/lib/supabase';

export async function OPTIONS() { return corsPreflight(); }

interface ProposalRow {
  id: string;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  price: number | null;
  payment_type: string | null;
  status: string;
  public_token: string | null;
  sent_at: string | null;
  signed_at: string | null;
  paid_at: string | null;
  created_at: string;
}

function shape(p: ProposalRow, appUrl: string) {
  return {
    id: p.id,
    customer_name: p.customer_name || '',
    customer_email: p.customer_email || '',
    customer_phone: p.customer_phone || '',
    price_cents: p.price ?? 0,
    price_dollars: ((p.price ?? 0) / 100).toFixed(2),
    payment_type: p.payment_type || 'full',
    status: p.status,
    public_url: p.public_token ? `${appUrl}/proposal/${p.public_token}` : null,
    sent_at: p.sent_at,
    signed_at: p.signed_at,
    paid_at: p.paid_at,
    created_at: p.created_at,
  };
}

/**
 * Polling trigger for "Proposal Signed" / "Proposal Sent" / "New Proposal".
 * Use `?status=signed` to filter. Defaults to most-recently-signed first.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateApiV1(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 100);
  const status = url.searchParams.get('status'); // optional: 'sent' | 'signed' | 'paid' | 'draft'
  // Sort by signed_at desc by default so Zapier sees newest signatures first.
  const orderBy = status === 'paid' ? 'paid_at' : status === 'sent' ? 'sent_at' : status === 'signed' ? 'signed_at' : 'created_at';

  let q = supabaseAdmin
    .from('proposals')
    .select('id, customer_name, customer_email, customer_phone, price, payment_type, status, public_token, sent_at, signed_at, paid_at, created_at')
    .eq('venue_id', auth.venueId)
    .order(orderBy, { ascending: false, nullsFirst: false })
    .limit(limit);
  if (status) q = q.eq('status', status);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS_HEADERS });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com';
  return NextResponse.json(
    { proposals: ((data || []) as ProposalRow[]).map((p) => shape(p, appUrl)) },
    { headers: CORS_HEADERS },
  );
}
