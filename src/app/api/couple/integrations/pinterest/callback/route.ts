import { NextRequest } from 'next/server';
import {
  exchangePinterestCode,
  fetchUserAccount,
  upsertPinterestConnection,
  verifyState,
} from '@/lib/pinterest';
import { safeRedirect } from '@/lib/safe-redirect';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET — Pinterest OAuth redirect target. Verifies the signed state to recover
 * the couple id, exchanges the code for tokens, stores the (encrypted)
 * connection, then redirects back to the inspiration board.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const oauthError = searchParams.get('error');

  if (oauthError) return safeRedirect('/couple/inspiration?pinterest=denied');

  const coupleId = verifyState(state);
  if (!code || !coupleId) return safeRedirect('/couple/inspiration?pinterest=error');

  try {
    const tokens = await exchangePinterestCode(code);
    if (!tokens.access_token) return safeRedirect('/couple/inspiration?pinterest=error');

    const account = await fetchUserAccount(tokens.access_token).catch(() => null);
    await upsertPinterestConnection(coupleId, tokens, {
      username: account?.username ?? null,
      id: account?.id ?? null,
    });
    return safeRedirect('/couple/inspiration?pinterest=connected');
  } catch (e) {
    console.error('[pinterest/callback]', e);
    return safeRedirect('/couple/inspiration?pinterest=error');
  }
}
