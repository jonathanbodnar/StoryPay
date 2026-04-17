import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email')?.toLowerCase().trim();
  if (!email) return NextResponse.json({ error: 'email param required' }, { status: 400 });

  const { data: venues, error: vErr } = await supabaseAdmin
    .from('venues')
    .select('id, name, email, owner_id, login_token, created_at')
    .ilike('email', email);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com';
  const login_urls = (venues ?? []).map((v) => ({
    venue_id: v.id,
    venue_name: v.name,
    login_url: v.login_token ? `${appUrl}/login/${v.login_token}` : null,
  }));

  return NextResponse.json({
    email,
    venues,
    venues_error: vErr?.message ?? null,
    login_urls,
  });
}
