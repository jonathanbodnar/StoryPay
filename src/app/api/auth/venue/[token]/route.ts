import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const url = new URL(request.url);

  try {
    const { data: venueToken, error: tokenError } = await supabaseAdmin
      .from('venue_tokens')
      .select('venue_id')
      .eq('token', token)
      .single();

    if (tokenError || !venueToken) {
      return NextResponse.redirect(new URL('/login/invalid', url.origin));
    }

    const { data: venue } = await supabaseAdmin
      .from('venues')
      .select('setup_completed')
      .eq('id', venueToken.venue_id)
      .single();

    const destination = venue?.setup_completed ? '/dashboard' : '/setup';
    const response = NextResponse.redirect(new URL(destination, url.origin));

    response.cookies.set('venue_id', venueToken.venue_id, {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
    });

    return response;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.redirect(
      new URL(`/login/error?msg=${encodeURIComponent(msg)}`, url.origin)
    );
  }
}
