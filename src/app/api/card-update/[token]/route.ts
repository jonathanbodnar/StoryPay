import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const { data: cardToken, error } = await supabaseAdmin
    .from('card_update_tokens')
    .select('*, venues(name, logo_url)')
    .eq('token', token)
    .single();

  if (error || !cardToken) {
    return NextResponse.json({ error: 'Invalid or expired link' }, { status: 404 });
  }

  if (cardToken.used) {
    return NextResponse.json({ error: 'This link has already been used' }, { status: 400 });
  }

  const venue = cardToken.venues as { name: string; logo_url: string | null } | null;

  return NextResponse.json({
    customer_name: cardToken.customer_name,
    customer_email: cardToken.customer_email,
    reason: cardToken.reason,
    venue_name: venue?.name ?? '',
    venue_logo_url: venue?.logo_url ?? null,
  });
}
