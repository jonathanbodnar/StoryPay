/**
 * GET/PUT /api/admin/payment-fees — StoryVenue's cut on venues' couple
 * payments (Stripe Connect), per plan tier. Changes apply to payments made
 * after the change. Give venues notice before raising them.
 *
 *   card_fee_percent    StoryVenue's % on any card, on top of Stripe's 2.9% + 30¢
 *   bank_total_percent  the venue's all-in % on a bank payment (StoryVenue keeps
 *                       it minus Stripe's 0.8%, max $5)
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyAdminCookie } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  if (!(await verifyAdminCookie())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data, error } = await supabaseAdmin
    .from('platform_payment_fee_tiers')
    .select('tier, card_fee_percent, bank_total_percent, updated_at')
    .order('tier', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tiers: data ?? [] });
}

export async function PUT(request: NextRequest) {
  if (!(await verifyAdminCookie())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { tier?: string; card_fee_percent?: number; bank_total_percent?: number };
  if (body.tier !== 'paid' && body.tier !== 'free') return NextResponse.json({ error: 'tier must be paid or free' }, { status: 400 });
  const card = Number(body.card_fee_percent);
  const bank = Number(body.bank_total_percent);
  if (!Number.isFinite(card) || card < 0 || card > 5 || !Number.isFinite(bank) || bank < 0 || bank > 5) {
    return NextResponse.json({ error: 'Percentages must be between 0 and 5.' }, { status: 400 });
  }
  const { error } = await supabaseAdmin
    .from('platform_payment_fee_tiers')
    .upsert({ tier: body.tier, card_fee_percent: card, bank_total_percent: bank, updated_at: new Date().toISOString() });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
