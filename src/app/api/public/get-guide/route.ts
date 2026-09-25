/**
 * POST /api/public/get-guide — the couple tapped "Send my guide".
 *
 * Body: { token, phone, email, weddingDate? }. The token (from the gated
 * invite email) is the only thing that identifies the lead; no session. The
 * tap, under the consent line on /get-guide/[token], is their opt-in to texts:
 * see completeGuideInvite in lib/guide-invite for what happens next (proof of
 * consent, Phase 1 guide by text + email, Phase 2 sequence).
 */

import { NextRequest, NextResponse } from 'next/server';
import { completeGuideInvite } from '@/lib/guide-invite';
import { rateLimit, getClientIp, formatRetryAfter } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const limited = rateLimit(`get-guide:${ip}`, 10, 10 * 60 * 1000);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: `Too many tries. Please wait ${formatRetryAfter(limited.retryAfterMs)} and try again.` },
      { status: 429 },
    );
  }

  let body: { token?: unknown; phone?: unknown; email?: unknown; weddingDate?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const str = (v: unknown) => (typeof v === 'string' ? v : '');

  const result = await completeGuideInvite({
    token: str(body.token),
    phone: str(body.phone),
    email: str(body.email),
    weddingDate: str(body.weddingDate) || null,
    ip,
    userAgent: request.headers.get('user-agent'),
    pageUrl: request.headers.get('referer'),
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, guideUrl: result.guideUrl, alreadyDone: result.alreadyDone });
}
