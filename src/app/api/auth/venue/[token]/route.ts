import { NextRequest } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { safeRedirect } from '@/lib/safe-redirect';

/** Generate a fresh URL-safe magic-link token (mirrors request-login). */
function newLoginToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  try {
    // Select the expiry/used columns when present so we can enforce TTL +
    // single-use semantics. If the migration hasn't run yet (legacy
    // schema), the columns simply come back as undefined and we fall back
    // to the original behaviour (no expiry, no rotation). Migration 122
    // adds them.
    const { data: venue, error: tokenError } = await supabaseAdmin
      .from('venues')
      .select('id, setup_completed, onboarding_status, login_token_expires_at, login_token_last_used_at')
      .eq('login_token', token)
      .single();

    if (tokenError || !venue) {
      return safeRedirect('/login/invalid');
    }

    // Reject expired tokens. A NULL expires_at after migration 122 means
    // the token has never been issued through request-login (i.e. it's
    // either pre-grace-period or a brand-new venue) — treat as invalid.
    const expiresAt = (venue as { login_token_expires_at?: string | null }).login_token_expires_at;
    if (expiresAt !== undefined) {
      if (!expiresAt) {
        return safeRedirect('/login/invalid');
      }
      if (new Date(expiresAt).getTime() < Date.now()) {
        return safeRedirect('/login/invalid');
      }
    }

    // Always go to the dashboard — StoryPay application is optional.
    // On first-ever login (setup not yet completed) pass ?welcome=1 so the
    // dashboard can pop open the StoryPay onboarding modal as a gentle prompt.
    const isFirstLogin = !venue.setup_completed;
    const destination = isFirstLogin ? '/dashboard?welcome=1' : '/dashboard';

    // Rotate the token on use so the URL becomes single-use. We DO keep
    // login_token populated (set to a fresh random value) so the column
    // is never null — other code reads it and it's also handy for admin.
    const updates: Record<string, unknown> = {};
    if (isFirstLogin) updates.setup_completed = true;
    if (expiresAt !== undefined) {
      updates.login_token = newLoginToken();
      updates.login_token_expires_at = null;
      updates.login_token_last_used_at = new Date().toISOString();
    }
    if (Object.keys(updates).length > 0) {
      await supabaseAdmin.from('venues').update(updates).eq('id', venue.id);
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
