import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { safeRedirect } from '@/lib/safe-redirect';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  try {
    const { data: venue, error: tokenError } = await supabaseAdmin
      .from('venues')
      .select('id, setup_completed, onboarding_status')
      .eq('login_token', token)
      .single();

    if (tokenError || !venue) {
      return safeRedirect('/login/invalid');
    }

    // Always go to the dashboard — StoryPay application is optional.
    // On first-ever login (setup not yet completed) pass ?welcome=1 so the
    // dashboard can pop open the StoryPay onboarding modal as a gentle prompt.
    const isFirstLogin = !venue.setup_completed;
    const destination = isFirstLogin ? '/dashboard?welcome=1' : '/dashboard';

    if (isFirstLogin) {
      await supabaseAdmin
        .from('venues')
        .update({ setup_completed: true })
        .eq('id', venue.id);
    }
    const response = safeRedirect(destination);

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
    return safeRedirect(`/login/error?msg=${encodeURIComponent(msg)}`);
  }
}
