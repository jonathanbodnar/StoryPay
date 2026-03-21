import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

function getBaseUrl(request: NextRequest): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) return appUrl;

  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  return host ? `${proto}://${host}` : 'https://storypay.io';
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const base = getBaseUrl(request);

  try {
    const { data: venueToken, error: tokenError } = await supabaseAdmin
      .from('venue_tokens')
      .select('venue_id')
      .eq('token', token)
      .single();

    if (tokenError || !venueToken) {
      return NextResponse.redirect(`${base}/login/invalid`);
    }

    const { data: venue } = await supabaseAdmin
      .from('venues')
      .select('setup_completed')
      .eq('id', venueToken.venue_id)
      .single();

    const destination = venue?.setup_completed ? '/dashboard' : '/setup';
    const response = NextResponse.redirect(`${base}${destination}`);

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
      `${base}/login/error?msg=${encodeURIComponent(msg)}`
    );
  }
}
