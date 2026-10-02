/**
 * GET /api/staging/outbox?to=&since=  — emails the test copy would have sent
 * POST   /api/staging/outbox {quietMinutes} — quiet mode: email nobody for a while
 * DELETE /api/staging/outbox          — empty it
 * Test copy only (behind its password page); not found on the live site.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isStaging, setStagingQuiet } from '@/lib/staging';
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

export async function POST(request: NextRequest) {
  if (!isStaging()) return new Response('Not found', { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { quietMinutes?: unknown };
  const minutes = Number(body.quietMinutes);
  if (!Number.isFinite(minutes)) return NextResponse.json({ error: 'quietMinutes is required' }, { status: 400 });
  setStagingQuiet(minutes);
  return NextResponse.json({ ok: true, quietMinutes: minutes });
}
