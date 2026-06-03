import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { safeRedirect } from '@/lib/safe-redirect';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/auth/admin-venue/[token]
 *
 * Permanent admin login route. Looks up a venue by its admin_login_token
 * (a UUID that never expires and is never rotated), then sets the session
 * cookie and redirects to the dashboard.
 *
 * Used exclusively by the "Copy login" button in the StoryVenue admin
 * portal. Unlike the user-facing /api/auth/venue/[token] route, this:
 *   • Has no expiry check
 *   • Never rotates the token (link stays valid forever)
 *   • Does not require the venue to have completed setup
 *
 * To invalidate a link (e.g. security incident), run:
 *   UPDATE venues SET admin_login_token = gen_random_uuid() WHERE id = '...';
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  if (!token) return safeRedirect('/login/invalid');

  try {
    const { data: venue, error } = await supabaseAdmin
      .from('venues')
      .select('id, setup_completed')
      .eq('admin_login_token', token)
      .maybeSingle();

    if (error || !venue) {
      return safeRedirect('/login/invalid');
    }

    const isFirstLogin = !venue.setup_completed;
    const destination = isFirstLogin ? '/dashboard?welcome=1' : '/dashboard';

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
