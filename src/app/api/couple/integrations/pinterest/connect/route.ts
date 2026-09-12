import { NextRequest, NextResponse } from 'next/server';
import { getCoupleAuthUser } from '@/lib/couple-server';
import { getPinterestAuthUrl, isPinterestConfigured, signState } from '@/lib/pinterest';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST — begin the Pinterest OAuth flow. Returns the authorize URL the client
 * should navigate to. The couple id is carried in an HMAC-signed `state` param
 * so the (cookie-less) callback can associate the tokens with this bride.
 */
export async function POST(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!isPinterestConfigured()) {
    return NextResponse.json(
      { error: 'Pinterest is not configured yet. Add PINTEREST_CLIENT_ID and PINTEREST_CLIENT_SECRET.' },
      { status: 503 },
    );
  }

  const url = getPinterestAuthUrl(signState(user.id));
  return NextResponse.json({ url });
}
