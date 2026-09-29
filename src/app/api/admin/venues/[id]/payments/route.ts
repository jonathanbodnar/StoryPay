/**
 * GET/PUT /api/admin/venues/[id]/payments — a venue's couple payments on
 * Stripe Connect: account status, and an optional fee override that replaces
 * its tier's rates (e.g. 0 for a private client). Blank = the tier's rates.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { connectedAccountDashboardUrl, feeTierFor, loadConnectVenue, loadFeeTiers } from '@/lib/stripe/connect';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await verifyAdminCookie())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const v = await loadConnectVenue(id);
  if (!v) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  const tier = await feeTierFor(v);
  const rates = (await loadFeeTiers())[tier];
  return NextResponse.json({
    provider: v.payments_provider,
    account: v.stripe_account_id
      ? { id: v.stripe_account_id, status: v.stripe_account_status, chargesEnabled: v.stripe_charges_enabled === true, url: connectedAccountDashboardUrl(v.stripe_account_id) }
      : null,
    tier,
    tierRates: rates,
    override: {
      card_fee_percent: v.payment_fee_card_percent != null ? Number(v.payment_fee_card_percent) : null,
      bank_total_percent: v.payment_fee_bank_percent != null ? Number(v.payment_fee_bank_percent) : null,
    },
  });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await verifyAdminCookie())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { card_fee_percent?: number | null; bank_total_percent?: number | null };
  const clean = (x: unknown): number | null | 'bad' => {
    if (x === null || x === undefined || x === '') return null;
    const n = Number(x);
    return Number.isFinite(n) && n >= 0 && n <= 5 ? n : 'bad';
  };
  const card = clean(body.card_fee_percent);
  const bank = clean(body.bank_total_percent);
  if (card === 'bad' || bank === 'bad') return NextResponse.json({ error: 'Percentages must be between 0 and 5, or blank.' }, { status: 400 });
  const { error } = await supabaseAdmin
    .from('venues')
    .update({ payment_fee_card_percent: card, payment_fee_bank_percent: bank })
    .eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
