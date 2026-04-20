import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from('venue_coupons')
    .select('*')
    .eq('venue_id', venueId)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ coupons: data ?? [] });
}

export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: {
    code?: string;
    name?: string;
    description?: string;
    discount_type?: 'percent' | 'fixed_cents';
    discount_percent?: number;
    discount_amount_cents?: number;
    max_redemptions?: number | null;
    active?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const code = (body.code || '').trim();
  const name = (body.name || '').trim();
  if (!code || !name) return NextResponse.json({ error: 'code and name are required' }, { status: 400 });

  const discount_type = body.discount_type === 'fixed_cents' ? 'fixed_cents' : 'percent';
  if (discount_type === 'percent') {
    const p = Number(body.discount_percent);
    if (!Number.isFinite(p) || p <= 0 || p > 100) {
      return NextResponse.json({ error: 'discount_percent must be between 0 and 100' }, { status: 400 });
    }
  } else {
    const c = body.discount_amount_cents;
    if (typeof c !== 'number' || !Number.isFinite(c) || c <= 0) {
      return NextResponse.json({ error: 'discount_amount_cents must be a positive integer' }, { status: 400 });
    }
  }

  let max_redemptions: number | null = body.max_redemptions ?? null;
  if (max_redemptions !== null) {
    if (!Number.isFinite(max_redemptions) || max_redemptions < 1) {
      return NextResponse.json({ error: 'max_redemptions must be at least 1 or null for unlimited' }, { status: 400 });
    }
    max_redemptions = Math.floor(max_redemptions);
  }

  const insert = {
    venue_id: venueId,
    code,
    name,
    description: body.description?.trim() || null,
    discount_type,
    discount_percent: discount_type === 'percent' ? body.discount_percent : null,
    discount_amount_cents: discount_type === 'fixed_cents' ? Math.round(body.discount_amount_cents!) : null,
    max_redemptions,
    active: body.active !== false,
  };

  const { data, error } = await supabaseAdmin.from('venue_coupons').insert(insert).select('*').single();

  if (error) {
    if (/duplicate|unique/i.test(error.message)) {
      return NextResponse.json({ error: 'A coupon with this code already exists.' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ coupon: data }, { status: 201 });
}
