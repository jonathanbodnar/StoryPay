import { NextRequest, NextResponse } from 'next/server';
import { verifyMinisiteSignature } from '@/lib/minisite-webhook';
import { rateLimit } from '@/lib/rate-limit';
import {
  getCoupleSitePasswordHash,
  verifySitePassword,
  minisiteUnlockToken,
} from '@/lib/couple-sites';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST — verify a visitor's password for a private minisite. HMAC-signed by the
 * weddingdirectory proxy. On success returns an unlock token bound to the slug +
 * current password hash, which the proxy stores as a cookie and replays to the
 * public GET (?k=). Rotating the password invalidates old tokens automatically.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const rawBody = await req.text();
  if (!verifyMinisiteSignature(rawBody, req.headers.get('x-storypay-signature'))) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let body: { password?: unknown };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const password = String(body.password ?? '');
  // The directory calls on every visitor's behalf, so guesses are limited per
  // site: enough for real guests mistyping, not enough to work through a list.
  if (!rateLimit(`minisite-unlock:${slug}`, 30, 10 * 60 * 1000).allowed) {
    return NextResponse.json({ ok: false, error: 'Too many tries. Please wait a few minutes.' }, { status: 429 });
  }
  const hash = await getCoupleSitePasswordHash(slug);
  // No password set → nothing to unlock (treat as open).
  if (!hash) return NextResponse.json({ ok: true, token: '' });

  if (!verifySitePassword(password, hash)) {
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  return NextResponse.json({ ok: true, token: minisiteUnlockToken(slug, hash) });
}
