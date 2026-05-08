import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { safeRedirect } from '@/lib/safe-redirect';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  try {
    const { data: member, error } = await supabaseAdmin
      .from('venue_team_members')
      .select('id, venue_id, status')
      .eq('invite_token', token)
      .maybeSingle();

    if (error || !member) {
      return safeRedirect('/invite/invalid');
    }

    await supabaseAdmin
      .from('venue_team_members')
      .update({ status: 'active' })
      .eq('id', member.id);

    const response = safeRedirect('/dashboard');
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
    return safeRedirect('/invite/invalid');
  }
}
