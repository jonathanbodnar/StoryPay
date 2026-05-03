import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';
import { loadAddonPrices } from '@/lib/venue-billing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/admin/addon-prices — returns current admin-configured prices */
export async function GET() {
  const authed = await verifyAdminCookie();
  if (!authed) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const prices = await loadAddonPrices();
    return NextResponse.json(prices);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/addon-prices
 * Body: { verified_cents?: number; sponsored_cents?: number; concierge_cents?: number }
 *
 * Updates only the keys that are present. Prices must be non-negative integers.
 * Existing venues keep their LunarPay subscription amount unchanged — only new
 * checkouts and plan changes will reflect the updated price.
 */
export async function PATCH(req: NextRequest) {
  const authed = await verifyAdminCookie();
  if (!authed) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const updates: { key: string; price_cents: number }[] = [];

  for (const [field, dbKey] of [
    ['verified_cents',  'verified'],
    ['sponsored_cents', 'sponsored'],
    ['concierge_cents', 'concierge'],
  ] as [string, string][]) {
    if (!(field in body)) continue;
    const raw = body[field];
    const val = typeof raw === 'string' ? parseInt(raw, 10) : Number(raw);
    if (!Number.isFinite(val) || val < 0) {
      return NextResponse.json(
        { error: `${field} must be a non-negative integer (cents)` },
        { status: 400 },
      );
    }
    updates.push({ key: dbKey, price_cents: Math.round(val) });
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  // Upsert each price row
  for (const row of updates) {
    const { error } = await supabaseAdmin
      .from('platform_addon_prices')
      .upsert({ key: row.key, price_cents: row.price_cents, updated_at: new Date().toISOString() }, {
        onConflict: 'key',
      });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  const prices = await loadAddonPrices();
  return NextResponse.json({ ok: true, prices });
}
