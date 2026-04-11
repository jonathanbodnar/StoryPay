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
    const { data: venue, error: tokenError } = await supabaseAdmin
      .from('venues')
      .select('id, setup_completed, onboarding_status')
      .eq('login_token', token)
      .single();

    if (tokenError || !venue) {
      return NextResponse.redirect(`${base}/login/invalid`);
    }

    const destination = venue.setup_completed
      ? '/dashboard'
      : venue.onboarding_status === 'active'
        ? '/dashboard'
        : '/setup';

    if (!venue.setup_completed && venue.onboarding_status === 'active') {
      await supabaseAdmin
        .from('venues')
        .update({ setup_completed: true })
        .eq('id', venue.id);
    }
    const response = NextResponse.redirect(`${base}${destination}`);

    response.cookies.set('venue_id', venue.id, {
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
