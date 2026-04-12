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
    // Look up the invite token
    const { data: member, error } = await supabaseAdmin
      .from('venue_team_members')
      .select('id, venue_id, status')
      .eq('invite_token', token)
      .maybeSingle();

    if (error || !member) {
      return NextResponse.redirect(`${base}/invite/invalid`);
    }

    // Mark as accepted
    await supabaseAdmin
      .from('venue_team_members')
      .update({ status: 'active' })
      .eq('id', member.id);

    // Set venue_id + member_id cookies so the session knows this is a team member
    const response = NextResponse.redirect(`${base}/dashboard`);
    response.cookies.set('venue_id', member.venue_id, {
      path: '/', httpOnly: true, secure: true, sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
    });
    response.cookies.set('member_id', member.id, {
      path: '/', httpOnly: true, secure: true, sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
    });

    return response;
  } catch (err) {
    console.error('[invite] error:', err);
    return NextResponse.redirect(`${base}/invite/invalid`);
  }
}
