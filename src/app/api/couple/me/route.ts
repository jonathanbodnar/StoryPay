import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getCoupleAuthUser } from '@/lib/couple-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function ensureProfile(userId: string, meta: Record<string, unknown>) {
  const { data: existing } = await supabaseAdmin
    .from('couple_profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (existing) return existing;

  const display =
    (typeof meta.display_name === 'string' && meta.display_name) ||
    (typeof meta.full_name === 'string' && meta.full_name) ||
    null;

  const { data: inserted, error } = await supabaseAdmin
    .from('couple_profiles')
    .insert({
      id: userId,
      display_name: display,
    })
    .select('*')
    .maybeSingle();

  if (error) {
    console.error('[couple/me] ensureProfile', error);
    return null;
  }
  return inserted;
}

export async function GET(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const profile = await ensureProfile(user.id, user.user_metadata ?? {});

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
    },
    profile: profile ?? {
      id: user.id,
      display_name: null,
      phone: null,
      address_line1: null,
      address_line2: null,
      city: null,
      state: null,
      postal_code: null,
      country: 'US',
      instagram_url: null,
      facebook_url: null,
      tiktok_url: null,
      pinterest_url: null,
      wedding_date: null,
    },
  });
}
