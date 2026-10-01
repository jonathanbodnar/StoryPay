/**
 * GET /api/staging/outbox?to=&since=  — emails the test copy would have sent
 * DELETE /api/staging/outbox          — empty it
 * Test copy only (behind its password page); not found on the live site.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isStaging } from '@/lib/staging';
import { clearOutbox, readOutbox } from '@/lib/staging-outbox';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!isStaging()) return new Response('Not found', { status: 404 });
  const sp = request.nextUrl.searchParams;
  return NextResponse.json({ emails: readOutbox({ to: sp.get('to') ?? undefined, since: sp.get('since') ?? undefined }) });
}

export async function DELETE() {
  if (!isStaging()) return new Response('Not found', { status: 404 });
  clearOutbox();
  return NextResponse.json({ ok: true });
}
